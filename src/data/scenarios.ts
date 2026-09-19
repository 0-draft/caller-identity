import type { Scenario } from "../lib/types";

/**
 * Every wire message below is the real shape of the call. The Authorization
 * headers on signed steps are not written here: steps carrying a `signing`
 * block have their signature computed in the browser and injected, so what the
 * page shows is what the algorithm actually produces.
 */

// AWS's own published example key pair. Using it keeps every computed
// signature deterministic, and makes clear that nothing here is a real secret.
const DEMO_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const LONG_TERM_KEY = "AKIAIOSFODNN7EXAMPLE";
const TEMP_KEY = "ASIAIOSFODNN7EXAMPLE";
const SESSION_TOKEN =
  "IQoJb3JpZ2luX2VjEBYaCXVzLWVhc3QtMSJHMEUCIQDEXAMPLEEXAMPLEEXAMPLE";
const DATETIME = "20260919T120000Z";
const EMPTY_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const GITHUB_JWT_PAYLOAD = `{
  "iss": "https://token.actions.githubusercontent.com",
  "aud": "sts.amazonaws.com",
  "sub": "repo:0-draft/caller-identity:ref:refs/heads/main",
  "repository": "0-draft/caller-identity",
  "repository_owner": "0-draft",
  "workflow": "deploy",
  "job_workflow_ref": "0-draft/caller-identity/.github/workflows/deploy.yml@refs/heads/main",
  "exp": 1789099200,
  "iat": 1789098300
}`;

const stsAssumeRoleResponse = (action: string) => `<${action}Response xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <${action}Result>
    <Credentials>
      <AccessKeyId>${TEMP_KEY}</AccessKeyId>
      <SecretAccessKey>${DEMO_SECRET}</SecretAccessKey>
      <SessionToken>${SESSION_TOKEN}</SessionToken>
      <Expiration>2026-09-19T13:00:00Z</Expiration>
    </Credentials>
    <AssumedRoleUser>
      <Arn>arn:aws:sts::111111111111:assumed-role/AppRole/demo-session</Arn>
      <AssumedRoleId>AROAEXAMPLEID:demo-session</AssumedRoleId>
    </AssumedRoleUser>
  </${action}Result>
</${action}Response>`;

/** The final S3 call, shared by every path that ends in temporary credentials. */
const s3WithTemporaryCredentials = (id: string) =>
  ({
    id,
    phases: ["sign", "verify", "authorize"],
    from: "client",
    to: "service",
    title: {
      en: "Call S3 with the temporary credentials",
      ja: "一時クレデンシャルで S3 を呼ぶ",
    },
    narrative: {
      en: "The three parts arrive together: ASIA... goes in Credential=, the secret never leaves the process, and the session token rides in its own header. Leave that header out of SignedHeaders and the request dies with SignatureDoesNotMatch.",
      ja: "3点セットが揃って初めて成立する。ASIA... は Credential= に、secret はプロセス外に出ず、session token は専用ヘッダに載る。このヘッダを SignedHeaders に入れ忘れると SignatureDoesNotMatch で落ちる。",
    },
    signing: {
      request: {
        method: "GET",
        path: "/key.txt",
        headers: {
          host: "my-bucket.s3.us-east-1.amazonaws.com",
          "x-amz-content-sha256": EMPTY_HASH,
          "x-amz-date": DATETIME,
        },
      },
      credentials: {
        accessKeyId: TEMP_KEY,
        secretAccessKey: DEMO_SECRET,
        sessionToken: SESSION_TOKEN,
      },
      options: {
        region: "us-east-1",
        service: "s3",
        datetime: DATETIME,
        doubleEncodePath: false,
      },
    },
    request: {
      start: "GET /key.txt HTTP/1.1",
      headers: [
        ["Host", "my-bucket.s3.us-east-1.amazonaws.com"],
        ["X-Amz-Content-Sha256", EMPTY_HASH],
        ["X-Amz-Date", DATETIME],
        ["X-Amz-Security-Token", SESSION_TOKEN],
      ],
      annotations: [
        {
          match: "X-Amz-Security-Token",
          tone: "key",
          note: {
            en: "The third component. It is an encrypted blob AWS decrypts to recover the session's secret and its policy.",
            ja: "3つ目の要素。AWS が復号してセッションの秘密鍵とポリシーを取り出す暗号化ブロブ。",
          },
        },
        {
          match: "X-Amz-Content-Sha256",
          tone: "info",
          note: {
            en: "SHA-256 of the body. An empty body still hashes, which is why this constant shows up everywhere.",
            ja: "ボディの SHA-256。空ボディでもハッシュは取るので、この定数があちこちに出てくる。",
          },
        },
      ],
    },
    response: {
      start: "HTTP/1.1 200 OK",
      headers: [
        ["x-amz-request-id", "9A8B7C6D5E4F3210"],
        ["Content-Type", "text/plain"],
      ],
      body: "hello from s3\n",
    },
    serverSide: [
      {
        title: {
          en: "Rebuild the canonical request",
          ja: "canonical request を組み立て直す",
        },
        detail: {
          en: "S3 reads the method, path, query, the headers named in SignedHeaders and the payload hash, and assembles the identical string.",
          ja: "メソッド・パス・クエリ・SignedHeaders に挙がったヘッダ・ペイロードハッシュを読み、全く同じ文字列を組み立てる。",
        },
      },
      {
        title: {
          en: "Recover the session secret",
          ja: "セッションの秘密鍵を復元する",
        },
        detail: {
          en: "Credential= names ASIA..., so the token in X-Amz-Security-Token is decrypted to get the matching secret and the session's attached policy.",
          ja: "Credential= が ASIA... なので、X-Amz-Security-Token を復号して対応する secret とセッションに付いたポリシーを得る。",
        },
      },
      {
        title: { en: "Compare, then authorize", ja: "照合してから認可" },
        detail: {
          en: "Signatures match, so the principal is assumed-role/AppRole/demo-session. Only then are the identity policy, bucket policy, SCP and session policy evaluated.",
          ja: "署名が一致したので principal は assumed-role/AppRole/demo-session に確定。そこで初めて identity policy / bucket policy / SCP / session policy が評価される。",
        },
        tone: "good",
      },
    ],
  }) satisfies Scenario["steps"][number];

export const scenarios: Scenario[] = [
  {
    id: "long-term-key",
    title: { en: "Long-term access key", ja: "長期アクセスキー" },
    tagline: {
      en: "The baseline. Two components, no expiry, no STS anywhere.",
      ja: "基準線。2点セット、期限なし、STS を一切通らない。",
    },
    credential: { en: "AKIA... + secret", ja: "AKIA... + secret" },
    why: {
      en: "The only AWS credential with no expiration. IAM issues it directly, which is exactly why it is discouraged.",
      ja: "期限のない唯一の AWS クレデンシャル。IAM が直接発行する。それがそのまま非推奨の理由でもある。",
    },
    steps: [
      {
        id: "create-key",
        phases: ["issue"],
        from: "client",
        to: "iam",
        title: { en: "IAM mints the key pair", ja: "IAM がキーペアを発行" },
        narrative: {
          en: "No STS involved. CreateAccessKey returns a secret that is shown once and never again, and it stays valid until somebody deletes it.",
          ja: "STS は関与しない。CreateAccessKey が返す secret は一度しか表示されず、誰かが消すまで有効であり続ける。",
        },
        request: {
          start: "POST / HTTP/1.1",
          headers: [
            ["Host", "iam.amazonaws.com"],
            ["Content-Type", "application/x-www-form-urlencoded; charset=utf-8"],
          ],
          body: "Action=CreateAccessKey&UserName=app-user&Version=2010-05-08",
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/xml"]],
          body: `<CreateAccessKeyResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
  <CreateAccessKeyResult>
    <AccessKey>
      <UserName>app-user</UserName>
      <AccessKeyId>${LONG_TERM_KEY}</AccessKeyId>
      <SecretAccessKey>${DEMO_SECRET}</SecretAccessKey>
      <Status>Active</Status>
    </AccessKey>
  </CreateAccessKeyResult>
</CreateAccessKeyResponse>`,
          annotations: [
            {
              match: "<Status>Active</Status>",
              tone: "warn",
              note: {
                en: "No Expiration element. That absence is the whole risk.",
                ja: "Expiration 要素が無い。この「無い」ことがリスクそのもの。",
              },
            },
            {
              match: LONG_TERM_KEY,
              tone: "key",
              note: {
                en: "AKIA prefix marks a long-term key. ASIA marks a temporary one.",
                ja: "AKIA が長期キー、ASIA が一時キーの目印。",
              },
            },
          ],
        },
        serverSide: [
          {
            title: { en: "Stored, not derived", ja: "保管であって導出ではない" },
            detail: {
              en: "AWS keeps the secret so it can recompute signatures later. Nothing about the key encodes an expiry, a role or a session.",
              ja: "後で署名を再計算するために AWS 側が secret を保持する。キー自体に期限・ロール・セッションの情報は一切入っていない。",
            },
          },
          {
            title: { en: "Two per user, forever", ja: "1ユーザー2本、無期限" },
            detail: {
              en: "An IAM user can hold at most two active keys, which is what makes rotation possible at all.",
              ja: "IAM user が持てるアクティブキーは最大2本。これがローテーションを成立させている唯一の仕組み。",
            },
          },
        ],
      },
      {
        id: "sign-s3",
        phases: ["sign", "verify", "authorize"],
        from: "client",
        to: "service",
        title: { en: "Sign an S3 request with it", ja: "そのまま S3 リクエストに署名" },
        narrative: {
          en: "Two components only, so there is no X-Amz-Security-Token header. The signing maths is otherwise identical to the temporary-credential case.",
          ja: "2点セットなので X-Amz-Security-Token ヘッダが無い。それ以外の署名計算は一時クレデンシャルの場合と完全に同じ。",
        },
        signing: {
          request: {
            method: "GET",
            path: "/key.txt",
            headers: {
              host: "my-bucket.s3.us-east-1.amazonaws.com",
              "x-amz-content-sha256": EMPTY_HASH,
              "x-amz-date": DATETIME,
            },
          },
          credentials: {
            accessKeyId: LONG_TERM_KEY,
            secretAccessKey: DEMO_SECRET,
          },
          options: {
            region: "us-east-1",
            service: "s3",
            datetime: DATETIME,
            doubleEncodePath: false,
          },
        },
        request: {
          start: "GET /key.txt HTTP/1.1",
          headers: [
            ["Host", "my-bucket.s3.us-east-1.amazonaws.com"],
            ["X-Amz-Content-Sha256", EMPTY_HASH],
            ["X-Amz-Date", DATETIME],
          ],
          annotations: [
            {
              match: "X-Amz-Date",
              tone: "info",
              note: {
                en: "Must be within 15 minutes of AWS's clock or you get RequestTimeTooSkewed. It narrows the replay window.",
                ja: "AWS の時計と15分以内にずれていないと RequestTimeTooSkewed。リプレイの窓を狭めるための仕掛け。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["x-amz-request-id", "1122334455667788"]],
          body: "hello from s3\n",
        },
        serverSide: [
          {
            title: { en: "Look the secret up by key id", ja: "key id から secret を引く" },
            detail: {
              en: "Credential= names AKIA..., so AWS fetches the stored secret for that IAM user and recomputes. There is no session blob to decrypt.",
              ja: "Credential= が AKIA... なので、その IAM user の保管済み secret を引いて再計算する。復号すべきセッションブロブは存在しない。",
            },
          },
          {
            title: { en: "The principal is the user itself", ja: "principal はユーザー本人" },
            detail: {
              en: "No role, no session name. CloudTrail records user/app-user, which is why attribution stops at the key rather than at a person.",
              ja: "ロールもセッション名も無い。CloudTrail には user/app-user としか残らないので、追跡は「キー」で止まり「人」まで届かない。",
            },
            tone: "warn",
          },
        ],
      },
    ],
  },

  {
    id: "assume-role",
    title: { en: "AssumeRole", ja: "AssumeRole" },
    tagline: {
      en: "A signed call to STS that returns a different, expiring identity.",
      ja: "STS への署名付き呼び出しが、期限付きの別の身元を返す。",
    },
    credential: { en: "ASIA... + secret + session token", ja: "ASIA... + secret + session token" },
    why: {
      en: "The chicken-and-egg case: you must already hold credentials to obtain these credentials.",
      ja: "鶏と卵のケース。このクレデンシャルを得るには、既にクレデンシャルを持っている必要がある。",
    },
    steps: [
      {
        id: "call-sts",
        phases: ["sign", "verify", "authorize", "issue"],
        from: "client",
        to: "sts",
        title: { en: "Sign a call to sts:AssumeRole", ja: "sts:AssumeRole に署名して呼ぶ" },
        narrative: {
          en: "STS is an ordinary AWS service, so this call is signed like any other, with the credentials you already have. Note the service name in the credential scope is sts.",
          ja: "STS も普通の AWS サービスなので、この呼び出し自体を既存のクレデンシャルで署名する。credential scope のサービス名が sts になっている点に注目。",
        },
        signing: {
          request: {
            method: "POST",
            path: "/",
            headers: {
              host: "sts.us-east-1.amazonaws.com",
              "content-type": "application/x-www-form-urlencoded; charset=utf-8",
              "x-amz-date": DATETIME,
            },
            body: "Action=AssumeRole&RoleArn=arn%3Aaws%3Aiam%3A%3A111111111111%3Arole%2FAppRole&RoleSessionName=demo-session&Version=2011-06-15",
          },
          credentials: {
            accessKeyId: LONG_TERM_KEY,
            secretAccessKey: DEMO_SECRET,
          },
          options: { region: "us-east-1", service: "sts", datetime: DATETIME },
        },
        request: {
          start: "POST / HTTP/1.1",
          headers: [
            ["Host", "sts.us-east-1.amazonaws.com"],
            ["Content-Type", "application/x-www-form-urlencoded; charset=utf-8"],
            ["X-Amz-Date", DATETIME],
          ],
          body: "Action=AssumeRole&RoleArn=arn%3Aaws%3Aiam%3A%3A111111111111%3Arole%2FAppRole&RoleSessionName=demo-session&Version=2011-06-15",
          annotations: [
            {
              match: "RoleSessionName=demo-session",
              tone: "key",
              note: {
                en: "This string becomes the session-yyy half of assumed-role/AppRole/session-yyy in CloudTrail. It is caller-supplied, so it is only as trustworthy as the caller.",
                ja: "この文字列が CloudTrail の assumed-role/AppRole/session-yyy の後半になる。呼び出し側が自由に決めるので、信頼度は呼び出し側と同じ。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/xml"]],
          body: stsAssumeRoleResponse("AssumeRole"),
          annotations: [
            {
              match: "<Expiration>2026-09-19T13:00:00Z</Expiration>",
              tone: "good",
              note: {
                en: "The difference that matters. Bounded by the role's MaxSessionDuration, 15 minutes to 12 hours.",
                ja: "決定的な差。ロールの MaxSessionDuration (15分〜12時間) で上限が決まる。",
              },
            },
            {
              match: TEMP_KEY,
              tone: "key",
              note: {
                en: "ASIA prefix. A different key id than the one that signed the request.",
                ja: "ASIA プレフィックス。リクエストに署名したキーとは別の key id。",
              },
            },
          ],
        },
        serverSide: [
          {
            title: { en: "Authenticate the caller first", ja: "まず呼び出し元を認証" },
            detail: {
              en: "Verify the SigV4 signature to establish who is asking. Only then is the question of whether they may assume the role even reachable.",
              ja: "SigV4 署名を検証して「誰が聞いているか」を確定する。そこまで来て初めて「assume してよいか」という問いに到達する。",
            },
          },
          {
            title: { en: "Evaluate the trust policy", ja: "trust policy を評価" },
            detail: {
              en: "The role's trust policy answers who may assume. The Action must be sts:AssumeRole exactly; writing it when the caller uses OIDC is the classic mismatch.",
              ja: "ロールの trust policy が「誰が assume してよいか」に答える。Action は sts:AssumeRole でなければならない。OIDC 経由なのにこれを書くのが典型的な取り違え。",
            },
          },
          {
            title: { en: "Mint and encrypt the session", ja: "セッションを作って暗号化" },
            detail: {
              en: "A fresh secret is generated and packed, with the session's policy and expiry, into the session token blob that the caller will echo back on every request.",
              ja: "新しい secret を生成し、セッションのポリシーと期限とともに session token のブロブに詰める。呼び出し側は以降これを毎リクエスト送り返す。",
            },
          },
        ],
      },
      s3WithTemporaryCredentials("s3-call"),
    ],
  },

  {
    id: "github-oidc",
    title: { en: "GitHub Actions OIDC", ja: "GitHub Actions OIDC" },
    tagline: {
      en: "The only STS calls that need no AWS credential at all.",
      ja: "AWS クレデンシャルを一切必要としない唯一の STS 呼び出し。",
    },
    credential: { en: "OIDC ID token → ASIA...", ja: "OIDC ID token → ASIA..." },
    why: {
      en: "It breaks the chicken-and-egg loop, which is what ends long-term keys in CI.",
      ja: "鶏と卵の輪を断ち切る。これが CI から長期キーを消せる理由。",
    },
    steps: [
      {
        id: "get-jwt",
        phases: ["issue"],
        from: "client",
        to: "idp",
        title: { en: "Ask GitHub for an ID token", ja: "GitHub に ID token を要求" },
        narrative: {
          en: "The runner holds a short-lived bearer token that only works inside this job. It exchanges it for a signed JWT naming this exact repository, ref and workflow.",
          ja: "runner はこのジョブの中でしか使えない短命の bearer token を持っている。それを、このリポジトリ・ref・ワークフローを名指しした署名付き JWT に交換する。",
        },
        request: {
          start: "GET /?audience=sts.amazonaws.com HTTP/1.1",
          headers: [
            ["Host", "pipelinesghubeus.actions.githubusercontent.com"],
            ["Authorization", "Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}"],
          ],
          annotations: [
            {
              match: "audience=sts.amazonaws.com",
              tone: "key",
              note: {
                en: "Sets the aud claim. The trust policy will insist on this exact value.",
                ja: "aud claim を決める。trust policy はこの値をピンポイントで要求する。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "application/json"]],
          body: `{"value":"eyJraWQiOiI...<header>.<payload>.<signature>"}

// decoded payload:
${GITHUB_JWT_PAYLOAD}`,
          annotations: [
            {
              match: '"sub": "repo:0-draft/caller-identity:ref:refs/heads/main"',
              tone: "key",
              note: {
                en: "The claim that carries all the authorization weight. Leave it unconstrained in the trust policy and any repository on GitHub can assume your role.",
                ja: "認可の重みを全部背負っている claim。trust policy でここを絞らないと、GitHub 上のどのリポジトリからでもロールを assume できてしまう。",
              },
            },
            {
              match: '"iss": "https://token.actions.githubusercontent.com"',
              tone: "info",
              note: {
                en: "Must match an IAM OIDC identity provider you registered up front.",
                ja: "事前に登録した IAM OIDC identity provider と一致している必要がある。",
              },
            },
          ],
        },
        serverSide: [
          {
            title: { en: "This half is not AWS", ja: "ここはまだ AWS ではない" },
            detail: {
              en: "GitHub is the issuer. AWS has not seen anything yet, and never holds a GitHub secret.",
              ja: "発行者は GitHub。AWS はまだ何も見ていないし、GitHub の秘密を持つこともない。",
            },
          },
        ],
      },
      {
        id: "exchange",
        phases: ["verify", "authorize", "issue"],
        from: "client",
        to: "sts",
        title: {
          en: "Exchange it via AssumeRoleWithWebIdentity",
          ja: "AssumeRoleWithWebIdentity で交換",
        },
        narrative: {
          en: "Look at what is missing: there is no Authorization header. This and AssumeRoleWithSAML are the only STS APIs callable with no AWS credential, and that is the entire point.",
          ja: "無いものを見てほしい。Authorization ヘッダが存在しない。これと AssumeRoleWithSAML だけが AWS クレデンシャル無しで呼べる STS API であり、それこそが要点。",
        },
        request: {
          start: "POST / HTTP/1.1",
          headers: [
            ["Host", "sts.us-east-1.amazonaws.com"],
            ["Content-Type", "application/x-www-form-urlencoded; charset=utf-8"],
          ],
          body: "Action=AssumeRoleWithWebIdentity&RoleArn=arn%3Aaws%3Aiam%3A%3A111111111111%3Arole%2FGitHubRole&RoleSessionName=gha&WebIdentityToken=eyJraWQiOiI...&Version=2011-06-15",
          annotations: [
            {
              match: "Content-Type",
              tone: "warn",
              note: {
                en: "No Authorization header follows. Unsigned. The JWT in the body is the only thing proving identity.",
                ja: "この後に Authorization ヘッダが続かない。未署名。身元を証明しているのはボディの JWT だけ。",
              },
            },
            {
              match: "WebIdentityToken=eyJraWQiOiI...",
              tone: "key",
              note: {
                en: "Despite the parameter name, modern use always puts an OIDC ID token here, never an access token.",
                ja: "パラメータ名に反して、今どきの用途ではここに入るのは常に OIDC ID token。access token ではない。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/xml"]],
          body: stsAssumeRoleResponse("AssumeRoleWithWebIdentity"),
        },
        serverSide: [
          {
            title: { en: "Match iss to a registered provider", ja: "iss を登録済み provider と照合" },
            detail: {
              en: "The issuer must already exist as an IAM OIDC identity provider in the account. An unknown issuer is rejected before any crypto happens.",
              ja: "issuer がアカウント内の IAM OIDC identity provider として既に登録されている必要がある。未知の issuer は暗号検証に入る前に弾かれる。",
            },
          },
          {
            title: { en: "Fetch JWKS and verify the signature", ja: "JWKS を取得して署名検証" },
            detail: {
              en: "AWS reads the provider's /.well-known/openid-configuration, pulls the JWKS, and verifies the JWT signature. No shared secret exists between AWS and GitHub.",
              ja: "provider の /.well-known/openid-configuration を読み、JWKS を取得して JWT の署名を検証する。AWS と GitHub の間に共有秘密は存在しない。",
            },
          },
          {
            title: { en: "Check exp, aud, then the trust policy", ja: "exp, aud、そして trust policy" },
            detail: {
              en: "Expiry and audience first, then the trust policy conditions on token.actions.githubusercontent.com:sub decide whether this particular repository and ref may assume the role.",
              ja: "まず期限と audience、次に token.actions.githubusercontent.com:sub に対する trust policy の条件が、このリポジトリとこの ref に assume を許すかを決める。",
            },
            tone: "good",
          },
        ],
      },
      s3WithTemporaryCredentials("s3-call"),
    ],
  },

  {
    id: "imds",
    title: { en: "EC2 instance profile (IMDSv2)", ja: "EC2 instance profile (IMDSv2)" },
    tagline: {
      en: "Credentials appear out of a link-local address with no call to STS from your code.",
      ja: "自分のコードは STS を呼ばないのに、リンクローカルアドレスからクレデンシャルが降ってくる。",
    },
    credential: { en: "ASIA... + secret + session token", ja: "ASIA... + secret + session token" },
    why: {
      en: "This is why an EC2 instance or a Lambda needs no AKIA anywhere on disk.",
      ja: "EC2 や Lambda のディスク上に AKIA が1本も要らない理由がこれ。",
    },
    steps: [
      {
        id: "imds-token",
        phases: ["issue"],
        from: "client",
        to: "imds",
        title: { en: "Get an IMDSv2 session token", ja: "IMDSv2 のセッショントークンを取る" },
        narrative: {
          en: "A PUT, deliberately. A server-side request forgery can usually coerce a GET out of a vulnerable app, rarely a PUT with a custom header. That asymmetry is the whole defence.",
          ja: "あえて PUT。SSRF は脆弱なアプリから GET を引き出すことはできても、カスタムヘッダ付きの PUT はまず引き出せない。この非対称性が防御の全て。",
        },
        request: {
          start: "PUT /latest/api/token HTTP/1.1",
          headers: [
            ["Host", "169.254.169.254"],
            ["X-aws-ec2-metadata-token-ttl-seconds", "21600"],
          ],
          annotations: [
            {
              match: "PUT",
              tone: "key",
              note: {
                en: "IMDSv1 allowed a bare GET here. That is what made SSRF into credential theft.",
                ja: "IMDSv1 はここが素の GET だった。それが SSRF をクレデンシャル窃取に変えていた。",
              },
            },
            {
              match: "169.254.169.254",
              tone: "info",
              note: {
                en: "Link-local. Not routable, so it is reachable only from on the instance itself.",
                ja: "リンクローカル。ルーティングされないので、インスタンス上からしか到達できない。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/plain"]],
          body: "AQAEAMEXAMPLEtokenvalueEXAMPLE==",
        },
        serverSide: [
          {
            title: { en: "Not an AWS API call", ja: "AWS API 呼び出しではない" },
            detail: {
              en: "This never leaves the host. No SigV4, no IAM evaluation, no CloudTrail entry.",
              ja: "これはホストの外に出ない。SigV4 も IAM 評価も CloudTrail の記録も発生しない。",
            },
          },
        ],
      },
      {
        id: "imds-creds",
        phases: ["issue"],
        from: "client",
        to: "imds",
        title: { en: "Read the role credentials", ja: "ロールのクレデンシャルを読む" },
        narrative: {
          en: "The instance profile name is part of the path. What comes back is the same three components STS would have returned, because that is exactly where they came from.",
          ja: "instance profile 名がパスの一部になる。返ってくるのは STS が返すのと同じ3点セット。実際そこから来ているのだから当然。",
        },
        request: {
          start: "GET /latest/meta-data/iam/security-credentials/AppRole HTTP/1.1",
          headers: [
            ["Host", "169.254.169.254"],
            ["X-aws-ec2-metadata-token", "AQAEAMEXAMPLEtokenvalueEXAMPLE=="],
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/plain"]],
          body: `{
  "Code": "Success",
  "LastUpdated": "2026-09-19T11:45:00Z",
  "Type": "AWS-HMAC",
  "AccessKeyId": "${TEMP_KEY}",
  "SecretAccessKey": "${DEMO_SECRET}",
  "Token": "${SESSION_TOKEN}",
  "Expiration": "2026-09-19T18:00:00Z"
}`,
          annotations: [
            {
              match: '"Token"',
              tone: "key",
              note: {
                en: "Same session token, different spelling. The SDK maps it onto AWS_SESSION_TOKEN.",
                ja: "同じ session token の別名。SDK がこれを AWS_SESSION_TOKEN に対応付ける。",
              },
            },
            {
              match: '"Expiration": "2026-09-19T18:00:00Z"',
              tone: "info",
              note: {
                en: "The agent refreshes well before this. Hardcoding the values you see here is how you write code that dies in six hours.",
                ja: "エージェントはこのずっと前に取り直す。ここに見えた値をハードコードするのが「6時間後に死ぬコード」の書き方。",
              },
            },
          ],
        },
        serverSide: [
          {
            title: { en: "STS already ran, elsewhere", ja: "STS は既に別の場所で動いている" },
            detail: {
              en: "The EC2 control plane assumed the instance profile's role on your behalf and cached the result. Your process never signs an AssumeRole call.",
              ja: "EC2 のコントロールプレーンが代わりに instance profile のロールを assume して結果をキャッシュしている。自分のプロセスは AssumeRole に署名しない。",
            },
          },
          {
            title: { en: "The blast radius is the instance", ja: "影響範囲はインスタンス" },
            detail: {
              en: "Anything that can make an HTTP request from this host can read these. That is why the hop limit and IMDSv2 enforcement matter.",
              ja: "このホストから HTTP リクエストを出せるものは全部これを読める。hop limit と IMDSv2 強制が効いてくるのはそのため。",
            },
            tone: "warn",
          },
        ],
      },
      s3WithTemporaryCredentials("s3-call"),
    ],
  },

  {
    id: "bedrock-bearer",
    title: { en: "Bedrock API key (bearer)", ja: "Bedrock API キー (bearer)" },
    tagline: {
      en: "The path that skips SigV4 entirely. Newest, and the one that reintroduces a long-term secret.",
      ja: "SigV4 レイヤーごと迂回する経路。最も新しく、そして長期シークレットを復活させる経路。",
    },
    credential: { en: "Opaque bearer token", ja: "不透明な bearer token" },
    why: {
      en: "For tools that expect an API key and cannot be taught to sign. AWS's own guidance is to use it only when STS is impossible.",
      ja: "API キーを期待して署名を教え込めないツールのため。AWS 自身の案内も「STS が不可能な場合に限れ」。",
    },
    steps: [
      {
        id: "bearer-call",
        phases: ["verify", "authorize"],
        from: "client",
        to: "service",
        title: { en: "Call Bedrock with a bearer token", ja: "bearer token で Bedrock を呼ぶ" },
        narrative: {
          en: "One header, no canonical request, no signing key chain, no SDK required. Everything the rest of this page explains simply does not happen here.",
          ja: "ヘッダ1つ。canonical request も signing key チェーンも SDK も不要。このページで説明してきたことが、ここでは何一つ起きない。",
        },
        request: {
          start: "POST /model/us.anthropic.claude-sonnet-4-6/converse HTTP/1.1",
          headers: [
            ["Host", "bedrock-runtime.us-east-1.amazonaws.com"],
            ["Content-Type", "application/json"],
            ["Authorization", "Bearer ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl..."],
          ],
          body: `{"messages":[{"role":"user","content":[{"text":"Hello"}]}]}`,
          annotations: [
            {
              match: "Bearer ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl...",
              tone: "warn",
              note: {
                en: "Whoever holds this string is the caller. There is no signature binding it to this request, so it is replayable against any request until it expires.",
                ja: "この文字列を持っている者が呼び出し元。このリクエストに紐付ける署名が無いので、期限までは任意のリクエストに使い回せる。",
              },
            },
            {
              match: "Content-Type",
              tone: "info",
              note: {
                en: "No X-Amz-Date either, so there is no clock-skew window and no replay bound from the timestamp.",
                ja: "X-Amz-Date も無い。つまり時刻ずれの窓もタイムスタンプによるリプレイ制限も存在しない。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "application/json"]],
          body: `{"output":{"message":{"role":"assistant","content":[{"text":"Hello."}]}}}`,
        },
        serverSide: [
          {
            title: { en: "Validate the token server-side", ja: "サーバ側でトークンを検証" },
            detail: {
              en: "The token is looked up rather than recomputed. Nothing about the request body or headers is covered by it.",
              ja: "再計算ではなく照合。リクエストのボディやヘッダはこのトークンに一切カバーされていない。",
            },
          },
          {
            title: { en: "A long-term key hides behind it", ja: "背後に長期キーが隠れている" },
            detail: {
              en: "Creating a long-term Bedrock API key silently creates an IAM user and attaches AmazonBedrockLimitedAccess to it. Short-term keys inherit the calling principal instead and expire within 12 hours.",
              ja: "long-term の Bedrock API キーを作ると、裏で IAM user が自動生成され AmazonBedrockLimitedAccess が付く。short-term のほうは呼び出し元の権限を継承し、12時間以内に失効する。",
            },
            tone: "warn",
          },
          {
            title: { en: "Deny it if you do not need it", ja: "使わないなら禁止する" },
            detail: {
              en: "AWS recommends blocking API key creation with an SCP when the use case does not require it, precisely because it walks back the no-long-term-keys posture.",
              ja: "AWS 自身が「必要ないなら SCP で作成を禁止せよ」と案内している。長期キーを置かない方針を巻き戻すものだから。",
            },
          },
        ],
      },
    ],
  },
];
