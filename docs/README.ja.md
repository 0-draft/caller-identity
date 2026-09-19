[English](README.md) | **日本語**

# ノート

サイトがインタラクティブに見せている内容の、長い版。パネルに収まらない部分をここに置く。各仕組みが
なぜその形なのか、ドキュメントと実装がどこで食い違うのか、そしてここに書いた主張をどう検証したか。

## 目次

| ページ | 扱う内容 |
| --- | --- |
| [クレデンシャルの地図](01-credential-map.ja.md) | リクエストが身元を得る全経路と、それらが共有する3つの層 |
| [SigV4](02-sigv4.ja.md) | 署名の全工程。canonical request、鍵の連鎖、署名が守る範囲 |
| [フェデレーション](03-federation.ja.md) | STS の発行 API、OIDC、そして繰り返される trust policy の間違い |
| [presigned URL と SigV4a](04-variants.ja.md) | 同じ署名を URL に移したものと、非対称な複数リージョン版 |
| [検証](05-verification.ja.md) | 各主張の検証方法と、AWS ドキュメントで見つかった誤り |

## 短い版

層は3つ。混乱のほとんどは、この3つを一緒くたにすることから来る。

```mermaid
flowchart TD
  subgraph issue["クレデンシャルの出所"]
    iam["IAM<br/>CreateAccessKey"]
    sts["STS<br/>6つの発行 API"]
    imds["IMDS / コンテナエンドポイント<br/>プラットフォームが注入"]
  end

  subgraph sign["送信者を証明する方法"]
    sigv4["SigV4<br/>HMAC、共有秘密"]
    sigv4a["SigV4a<br/>ECDSA、公開鍵"]
    bearer["bearer token<br/>署名そのものが無い"]
  end

  subgraph decide["AWS 側の処理"]
    verify["再計算して照合<br/>ここで principal が確定"]
    authz["ポリシー評価<br/>identity / resource / SCP / session"]
  end

  iam --> sigv4
  sts --> sigv4
  sts --> sigv4a
  imds --> sigv4
  iam -. "API キー作成が<br/>IAM user を生む" .-> bearer

  sigv4 --> verify
  sigv4a --> verify
  bearer --> verify
  verify --> authz

  style bearer stroke-dasharray: 4 4
```

SigV4 は STS と紐づいていない。SigV4 は署名の層であり、長期キーも一時クレデンシャルも同じ層を
そのまま使う。STS はその層に供給する発行元の1つでしかない。bearer token は署名の層を丸ごと飛ばす。

一番多くを説明する事実はこれ。**`AccessDenied` が返ってきた時点で署名は既に通っている。** 認証と認可
は別のステップで、その順番であり、エラーがどちらを通過済みかを教えてくれる。

## 表記について

ここに出てくるキーは全て AWS が自身のドキュメントで公開しているサンプル値で、本物の秘密は含まない。
