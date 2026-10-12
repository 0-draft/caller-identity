[English](03-federation.md) | **日本語**

# フェデレーション

[ノートに戻る](README.ja.md)

## 6つの発行 API

STS は単一の関数ではない。クレデンシャルを返すのは次の操作。

| API | 入り口の条件 | 上限 |
| --- | --- | --- |
| `AssumeRole` | 既存の署名可能なクレデンシャル | ロールの `MaxSessionDuration` |
| `AssumeRoleWithSAML` | SAML assertion、**AWS クレデンシャル不要** | 同上 |
| `AssumeRoleWithWebIdentity` | OIDC ID token、**AWS クレデンシャル不要** | 同上 |
| `AssumeRoot` | 管理アカウント | 固定15分 |
| `GetSessionToken` | IAM user のキー、必要なら MFA | 12時間 |
| `GetFederationToken` | IAM user のキー | 12時間 |

`AssumeRole` の `DurationSeconds` は900秒以上で、ロールの `MaxSessionDuration` が上限。その
`MaxSessionDuration` 自体は1〜12時間で設定できる。既定は3600秒。assume したロールからさらに assume
(role chaining) すると、設定に関係なく上限が1時間に落ちる。「設定より早くセッションが切れる」の典型的
な原因がこれ。

`GetSessionToken` は新しい権限を与えない。IAM user の長期キーを、同じ権限を持つ一時クレデンシャルに
昇格させるだけで、必要なら `aws:MultiFactorAuthPresent` が立つ。名前が助けになるより誤解を招く回数の
方が多い。

session policy と session tag は session token の中に入るので、その分 token が大きくなる。2026年9月、STS は session token サイズの上限と、渡したパラメータの上限を別々に持つのをやめた。代わりに [session token サイズ 4,096 byte という単一の上限](https://aws.amazon.com/about-aws/whats-new/2026/09/aws-sts/)になった。入力そのものの平文の制限は残っていて、たとえば inline session policy は 2,048 文字まで。[`AssumeRole` のレスポンス](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)は byte 単位の `SessionTokenSize` と、上限に対する割合の `SessionTokenUtilization` を返すようになり、`PackedPolicySize` は後者に置き換わる形で非推奨になった。任意のリクエストパラメータ `MinimumSessionTokenSize` は token を指定サイズまで水増しする。本番で大きな token を受け取る前に、クライアントが扱えるか確認するためのパラメータである。

## なぜ2つだけ未署名なのか

STS を呼ぶには普通は署名が要り、署名にはクレデンシャルが要る。`AssumeRoleWithWebIdentity` と
`AssumeRoleWithSAML` は `Authorization` ヘッダ無しで呼べる。リクエストが「他人が署名した assertion」
を運び、AWS はそちらの署名を検証する。

```mermaid
sequenceDiagram
    participant R as GitHub runner
    participant G as GitHub OIDC provider
    participant S as AWS STS
    participant A as S3

    R->>G: GET .../oidctoken?...&audience=sts.amazonaws.com
    Note right of R: Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN
    G-->>R: repo と ref を名指しした署名付き JWT

    R->>S: POST / (AssumeRoleWithWebIdentity)
    Note right of R: Authorization ヘッダ無し<br/>ボディが JWT を運ぶ
    S->>G: /.well-known/jwks.json を取得
    G-->>S: 検証鍵
    S->>S: 署名、exp、aud を検証
    S->>S: ロールの trust policy を評価
    S-->>R: ASIA... + secret + session token

    R->>A: GET /key.txt、SigV4 署名付き
    A-->>R: 200
```

AWS と GitHub の間に共有秘密はどの時点でも存在しない。AWS は「信頼せよと言われた issuer」を信頼し、
その issuer から取得した鍵で署名を検証するだけ。

## access token ではなく ID token

パラメータ名は `WebIdentityToken` で、API リファレンスは「OAuth 2.0 access token または OpenID
Connect ID token」と書いている。両方受け付けるのは、この API が設計されたソーシャルログイン時代の
名残。今どきの用途はどれも OIDC の **ID token** を入れる。

この区別が効くのは、2つが別の問いに答えているから。

| | ID token | access token |
| --- | --- | --- |
| 主張する内容 | 呼び出し元が誰か | 呼び出し元に何が許されるか |
| audience | 要求したクライアント | リソースサーバ |
| 形式 | 必ず JWT | 規定なし、opaque なことも多い |
| 検証できる者 | JWKS があれば誰でも | 発行者だけ、ということが多い |

STS が欲しいのは身元の主張なので、ID token が正しい形。この非対称性はレスポンスにも残る。`Provider`
には、ID token なら `iss` の値が、access token 経路ならリクエストで渡した `ProviderId` が入る。

## 制御は trust policy が全部握っている

ここまでは仕組みの話。セキュリティ上の判断は1つのドキュメントに集約される。

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:0-draft/caller-identity:ref:refs/heads/main"
    }
  }
}
```

繰り返し現れる間違いは4つ。出現頻度の高い順。

1. **`sub` を全く絞っていない。** `aud` だけ見て終わっている。`aud` はインターネット上の全 GitHub
   Actions ワークフローで `sts.amazonaws.com` なので、その provider に到達できるリポジトリなら何でも
   このロールを assume できる。
2. **`repo:*` や裸の `*`。** 制約に見える。GitHub 上の全リポジトリに一致する。
3. **`repo:my-org/*`。** これは狭いが、特定の意味でまだ間違っている。後から org に追加された
   リポジトリを含み、乗っ取られたアカウントが作ったものも含み、pull request と fork を区別しない。
4. **`Action` に `sts:AssumeRole` と書く。** 呼び出す API 名がそのまま policy に書くべき `Action` 名
   になる。OIDC なら `sts:AssumeRoleWithWebIdentity`、SAML なら `sts:AssumeRoleWithSAML`。これは
   fail closed なので、4つの中では一番害が小さい。

サイトの trust policy パネルは、編集可能なトークンに対してこの4つを実際に評価する。読むのではなく
自分で起こせる。

### `sub` 以外で絞る

2026年1月、STS は GitHub、Google、CircleCI、Oracle Cloud Infrastructure の [provider 固有 claim を condition key として検証する](https://aws.amazon.com/about-aws/whats-new/2026/01/aws-sts-supports-validation-identity-provider-claims/)ようになった。制約を `sub` の文字列に押し込む必要はもう無い。GitHub なら `repository`、`repository_id`、`repository_owner_id`、`actor`、`actor_id`、`ref`、`environment`、`workflow`、`job_workflow_ref`、`enterprise_id` があり、`token.actions.githubusercontent.com:<claim>` の形で書く。trust policy と resource control policy で使え、[condition key のリファレンス](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)ではどれもセッションでは利用不可とされている。

数値 ID の claim は、`sub` では塞げない穴を塞ぐ。`sub` は名前から組み立てられていて、GitHub ではリネームや削除で空いたリポジトリ名・org 名を別人が取得できる。同じリファレンスも、名前だけに頼らず `repository_id`、`repository_owner_id`、`actor_id` のような不変の ID で照合するよう勧めている。下の ID は placeholder。

```json
"StringEquals": {
  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
  "token.actions.githubusercontent.com:repository_owner_id": "123456",
  "token.actions.githubusercontent.com:repository_id": "1296269",
  "token.actions.githubusercontent.com:ref": "refs/heads/main"
}
```

## outbound federation、鏡像

2025年後半から矢印は逆方向にも向く。`sts:GetWebIdentityToken` が AWS の身元を、外部サービスが検証
できる短命の署名付き JWT に交換する。これで AWS のワークロードは、相手の API キーを保管せずに
サードパーティへ認証できる。

| 向き | API | JWT に署名するのは | 検証するのは |
| --- | --- | --- | --- |
| AWS へ | `sts:AssumeRoleWithWebIdentity` | GitHub、Google、EKS | AWS STS |
| AWS から | `sts:GetWebIdentityToken` | AWS STS | 外部サービス |

有効化するとアカウント専用の issuer URL が払い出され、`/.well-known/openid-configuration` と
`/.well-known/jwks.json` をホストする。発行されるトークンの `sub` はロールの ARN。有効期間は60〜3600
秒で既定は300秒。`Audience`、`DurationSeconds`、`SigningAlgorithm` は開けっ放しにせず IAM policy の
condition で縛るべき。
