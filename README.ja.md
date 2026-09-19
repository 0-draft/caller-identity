[English](README.md) | **日本語**

# caller-identity

AWS が「お前は誰か」を決めるとき、ワイヤー上で実際に何が流れているか。

クレデンシャルが辿る経路を選んで 1 ステップずつ進むと、各ホップの実際の HTTP リクエストと、
それを受け取った AWS 側で何が起きているかが並んで読める。ページ上の署名は貼り付けた文字列では
なく WebCrypto がブラウザ内で計算したものなので、ヘッダを書き換えると署名が一致しなくなる様子を
その場で観察できる。

公開先は <https://0-draft.github.io/caller-identity/>。

## なぜ作ったか

AWS のドキュメントは SigV4 も STS も正確に説明している。ただし別々の場所で説明していて、どちらも
壊してみることができない。埋めたいのは「署名の計算方法は読んだ」と「失敗しているリクエストを見て
3 点セットのどれが欠けているか言える」の間にある隙間。

## 扱う経路

誰も使うべきでないものから、2 年前には存在しなかったものまで 5 本。

| 経路 | 行き着くクレデンシャル | 要点 |
| --- | --- | --- |
| 長期アクセスキー | `AKIA...` + secret | 基準線。IAM が発行し、STS を一切通らず、何も失効しない。 |
| AssumeRole | `ASIA...` + secret + session token | 鶏と卵。クレデンシャルを得るのにクレデンシャルが要る。 |
| GitHub Actions OIDC | OIDC ID token、そして `ASIA...` | AWS クレデンシャルを一切必要としない唯一の STS 呼び出し。 |
| EC2 instance profile (IMDSv2) | `ASIA...` + secret + session token | EC2 のディスクにキーが要らない理由と、`PUT` である理由。 |
| Bedrock API キー | 不透明な bearer token | SigV4 を丸ごと迂回し、裏で IAM user を作る経路。 |

各経路はシーケンス図として描かれる。矢印がリクエストそのもので、ライフラインはアクターが信頼境界の
どちら側にいるかで色分けしてある。自分の信頼ドメインを出ていく呼び出しが、知識ではなく色の変化として
見えるようにするため。各ステップは 4 つのバンド (発行 / 署名 / 検証 / 認可) のうちどれに触れるかを
宣言している。暗いままのバンドはその経路が飛ばしているもので、未署名の OIDC 交換と bearer token が
実際に何を迂回しているのかがそこに出る。

## チェックを走らせる

```bash
npm run typecheck     # tsc
npm run lint          # eslint (型情報あり)
npm run format:check  # prettier
npm run lint:md       # markdownlint
npm test              # AWS 公式ベクタに対する署名器の検証
npm run build
```

CI ではこれらをそれぞれ独立したジョブとして走らせ、加えて `npm audit` をマージ条件ではなく参考情報
として出している。Dependabot は npm とワークフローの action を監視していて、1 週間分の更新が十数本
ではなく数本の PR にまとまるようグループ化してある。

## 署名器について

`src/lib/sigv4.ts` は `crypto.subtle` 上の SigV4 実装で、最終的な hex 文字列だけでなく途中の値を
全部返す。見る価値があるのは途中のほうだから。canonical request は AWS が照合のために組み立て直す
文字列そのものだし、`kDate → kRegion → kService → kSigning` の連鎖は、signing key が漏れても
その日・そのリージョン・そのサービスにしか使えないことを決めている仕組みそのもの。

CI では AWS が Amazon Glacier 向けに公開している署名例と 1 バイト単位で照合している。canonical
request と string to sign も含めて一致を確認している。

このページについて 1 点注記がある。同じページには streaming の `Upload Archive` 用の 2 本目の例も
載っているが、canonical request は完全に再現できるのに、記載されている署名値が再現できない。この
署名器でも独立した Python 実装でも、ページ自身が印字している canonical request からは
`b09239743937...` ではなく `e8ba379a74...` が出る。ページのリクエスト構文には現れるが canonical
request には現れない 2 つのヘッダを足しても、さらに別の値になるので説明がつかない。テストでは
canonical request をドキュメントに対して、署名値を相互検算に対して検証している。

## 動かす

```bash
npm install
npm run dev        # http://localhost:5173/caller-identity/
```

## 秘密情報は含まれない

ページ上のキーは全て AWS 自身が公開しているサンプル値で、署名が決定的になり、かつ明らかに偽物と
分かるものを選んでいる。バックエンドもテレメトリもネットワーク呼び出しも存在しない。ページは静的
で、署名計算は全てブラウザのタブ内で完結する。
