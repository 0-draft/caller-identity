[English](04-variants.md) | **日本語**

# presigned URL と SigV4a

[ノートに戻る](README.ja.md)

同じ署名の変種が2つ。片方は署名を URL に移し、もう片方は非対称にする。どちらも「署名が何を守って
いるか」を変えるので、理解しておく価値がある。

## presigned URL

認証情報が `Authorization` ヘッダからクエリ文字列に移る。canonical request の他の部分は変わらない。

```text
https://examplebucket.s3.amazonaws.com/test.txt
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request
  &X-Amz-Date=20130524T000000Z
  &X-Amz-Expires=86400
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404
```

ヘッダ方式との違いは2つで、そこに要点がある。

**ペイロードハッシュが文字列 `UNSIGNED-PAYLOAD` そのもの。** 署名時点では何がアップロードされるか
分からないので、ボディを署名対象にできない。つまり presigned な `PUT` が認可しているのは「宛先」で
あって「バイト列」ではない。中身を決めるのは URL を持っている側。

**session token はクエリパラメータ**として canonical request の一部になる。署名対象ヘッダではない。

### 実質的に何なのか

期限付きの bearer credential。

```mermaid
flowchart LR
  you["自分<br/>クレデンシャルを持つ"] -->|ローカルで署名| url["URL 1本"]
  url --> anyone["誰でも<br/>AWS 身元は不要"]
  anyone -->|"素の GET"| s3["S3"]
  s3 -->|"CloudTrail に残るのは自分"| log["自分の principal"]

  style url stroke:#ff9900
  style log stroke:#ff6b6b
```

そこから直接導かれる結論が3つ。直接導かれるのに、それでも驚かれる。

- **個別に失効させられない。** 署名は AWS 側に何も登録しない。1本の presigned URL を止めるには、
  署名に使ったクレデンシャルをローテートするか無効化するしかない。
- **CloudTrail には自分が記録される。** URL を使った相手ではない。
- **URL はごく普通の経路で漏れる。** ブラウザ履歴、referrer ヘッダ、プロキシログ、チャット。チケットに
  貼られた presigned URL は、チケットに貼られたクレデンシャル。

被害を限定しているのは `X-Amz-Expires` だけ。S3 の上限は604800秒 (7日) で、signing key 自体がその
期間しか有効でないため。

## SigV4a

1つの署名を複数リージョンで有効にする必要がある場合 (S3 Multi-Region Access Point など) のための
方式。対称署名では、検証する全リージョンに共有秘密を配らない限り実現できない。だから非対称にする。

### 鍵の導出

鍵ペアは、既に持っている secret access key から作る。

```text
input_key = "AWS4A" || secret
label     = "AWS4-ECDSA-P256-SHA256"
context   = access_key_id || counter        (counter は1バイト)

key = KDF(input_key, label, context, 256)   NIST SP 800-108 counter モード、HMAC-SHA256
c   = Oct2Int(key)
if c > n - 2: counter を増やしてやり直す
else:         k = c + 1        秘密鍵
              Q = k * G        公開鍵
```

リトライは飾りではない。一様乱数の256bit整数は P-256 の位数を超えうるし、範囲外のスカラーは鍵として
無効。実際には最初の候補で通る。

KDF の1ブロックを展開するとこうなる。

```text
HMAC(input_key, uint32be(1) || label || 0x00 || access_key_id || counter || uint32be(256))
```

### 何が変わるか

```mermaid
flowchart TB
  subgraph v4["SigV4"]
    a1["scope: date/region/service/aws4_request"]
    a2["HMAC、共有秘密"]
    a3["検証する全リージョンが secret を必要とする"]
    a1 --> a2 --> a3
  end

  subgraph v4a["SigV4a"]
    b1["scope: date/service/aws4_request<br/>リージョン無し"]
    b2["ECDSA P-256、鍵ペア"]
    b3["検証側は公開鍵だけあればよい"]
    b1 --> b2 --> b3
  end
```

リージョンは credential scope から出て `X-Amz-Region-Set` に現れる。このヘッダ自体が署名対象なので、
「この署名がどのリージョンで有効だと主張しているか」も署名に守られる。ワイルドカードも使える。
`us-west-*` や `*`。

鍵が日付・リージョン・サービスで区切られなくなるため、SigV4 が持っていた被害範囲の制御は失われる。
同じ鍵ペアが全てに署名する。複数リージョンで有効になることの代償。

### 実装上の注意

WebCrypto だけでは実装できない。公開鍵の導出には「自分で選んだスカラーでベースポイントを倍する」
処理が要るが、`SubtleCrypto` にスカラー倍の API は無い。曲線演算はライブラリから持ってくるしかない。
このリポジトリは `@noble/curves` を使っている。

1つ書いておく価値のある帰結。`@noble/curves` は RFC 6979 の決定的 nonce が既定なので、ここでは同じ
リクエストに2回署名すると同じバイト列になる。AWS SDK は libcrypto 経由なのでそうならない。どちらも
検証は通り、再現するのは一方だけ。SigV4a の署名に固定テストベクタを書こうとすると、ここが効いてくる。
