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

/**
 * AssumeRole and AssumeRoleWithWebIdentity return the same Credentials shape.
 * The web identity variant adds three elements describing the token it
 * accepted, which is the only place the federated identity survives into the
 * response.
 */
const stsAssumeRoleResponse = (
  action: string,
  { role = "AppRole", session = "demo-session", webIdentity = false } = {},
) => {
  const federated = webIdentity
    ? `
    <SubjectFromWebIdentityToken>repo:0-draft/caller-identity:ref:refs/heads/main</SubjectFromWebIdentityToken>
    <Audience>sts.amazonaws.com</Audience>
    <Provider>https://token.actions.githubusercontent.com</Provider>`
    : "";

  return `<${action}Response xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <${action}Result>
    <Credentials>
      <AccessKeyId>${TEMP_KEY}</AccessKeyId>
      <SecretAccessKey>${DEMO_SECRET}</SecretAccessKey>
      <SessionToken>${SESSION_TOKEN}</SessionToken>
      <Expiration>2026-09-19T13:00:00Z</Expiration>
    </Credentials>
    <AssumedRoleUser>
      <Arn>arn:aws:sts::111111111111:assumed-role/${role}/${session}</Arn>
      <AssumedRoleId>AROAEXAMPLEID:${session}</AssumedRoleId>
    </AssumedRoleUser>${federated}
  </${action}Result>
  <ResponseMetadata>
    <RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId>
  </ResponseMetadata>
</${action}Response>`;
};

/**
 * The step between "STS returned three strings" and "here is a signed request".
 * It happens inside your own process, so there is no wire message; without it
 * the jump from the previous step to the next one looks like magic.
 */
const credentialHandoffStep = (id: string) =>
  ({
    id,
    phases: ["issue"],
    from: "client",
    to: "client",
    title: {
      en: "Hand the three values to the signer",
      ja: "3つの値を署名側に渡す",
    },
    narrative: {
      en: "Nothing leaves the machine here. The three strings have to reach whatever computes the signature, and there are exactly three ways that happens. Whichever you pick, the next request is signed with them rather than with any long-term key.",
      ja: "ここでは何もマシンの外に出ない。3つの文字列を、署名を計算する側に届ける必要があるだけ。やり方は実質3通り。どれを選んでも、次のリクエストは長期キーではなくこの3つで署名される。",
    },
    handoff: [
      {
        label: { en: "Environment variables", ja: "環境変数" },
        syntax: "bash",
        code: `export AWS_ACCESS_KEY_ID=${TEMP_KEY}
export AWS_SECRET_ACCESS_KEY=${DEMO_SECRET}
export AWS_SESSION_TOKEN=${SESSION_TOKEN}

aws sts get-caller-identity
# => arn:aws:sts::111111111111:assumed-role/AppRole/demo-session`,
        note: {
          en: "The quickest path, and the one that bites. Switching back to a long-term key later without unsetting AWS_SESSION_TOKEN leaves a stale token attached to a key it does not belong to, and every request fails with InvalidClientTokenId.",
          ja: "一番手早く、一番刺さる方法。後で長期キーに戻すときに AWS_SESSION_TOKEN を unset し忘れると、無関係なキーに古いトークンが付いたままになり、全リクエストが InvalidClientTokenId で落ちる。",
        },
      },
      {
        label: { en: "Profile", ja: "プロファイル" },
        syntax: "ini",
        code: `# ~/.aws/config
[profile target]
role_arn = arn:aws:iam::111111111111:role/AppRole
source_profile = base
role_session_name = demo-session

# aws s3 ls --profile target`,
        note: {
          en: "The CLI performs the AssumeRole itself, caches the result under ~/.aws/cli/cache, and refreshes it when it expires. You never see the three values, which is the point.",
          ja: "CLI 自身が AssumeRole を実行し、結果を ~/.aws/cli/cache にキャッシュし、期限が来たら取り直す。3つの値を自分で見ることがないのが利点。",
        },
      },
      {
        label: { en: "SDK provider chain", ja: "SDK の provider chain" },
        syntax: "python",
        code: `import boto3

# On EC2, ECS, Lambda or EKS this is the whole integration.
# The chain finds the credentials and refreshes them before expiry.
s3 = boto3.client("s3")

# Pasting the three values in as static strings instead
# produces code that works now and dies at Expiration.`,
        note: {
          en: "The correct default whenever the workload runs on AWS. Copying the values out of a response into constructor arguments is the mistake this page exists to prevent: they expire, and static credentials do not refresh.",
          ja: "ワークロードが AWS 上で動くなら常にこれが正解。レスポンスから値をコピーしてコンストラクタ引数に貼るのが、このページが防ぎたい間違い。期限が来ても static なクレデンシャルは更新されない。",
        },
      },
    ],
    serverSide: [
      {
        title: { en: "AWS sees nothing yet", ja: "AWS からはまだ何も見えない" },
        detail: {
          en: "This step produces no API call and no CloudTrail entry. The credentials exist and are simply sitting in a process, a file or an environment block.",
          ja: "このステップは API 呼び出しも CloudTrail の記録も生まない。クレデンシャルは既に存在していて、プロセスかファイルか環境変数の中に置かれているだけ。",
        },
      },
      {
        title: { en: "The clock is already running", ja: "時計は既に動いている" },
        detail: {
          en: "Expiration was fixed when STS issued them, not when you start using them. Anything that holds the values without re-reading the source will stop working at that timestamp.",
          ja: "Expiration は STS が発行した時点で確定していて、使い始めた時点ではない。取得元を読み直さずに値を抱え込んだものは、その時刻に動かなくなる。",
        },
        tone: "warn",
      },
    ],
  }) satisfies Scenario["steps"][number];

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
            en: "The third component, and the one people forget. Its contents are opaque and AWS does not document the format; what matters is that AWS resolves it to this session's secret and its attached policy, and that it is covered by the signature.",
            ja: "3つ目の要素であり、忘れられる要素。中身は不透明で AWS もフォーマットを公開していない。重要なのは、AWS がこれをこのセッションの secret と付随ポリシーに解決すること、そして署名の対象に含まれること。",
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
      summary: {
        en: "200 · signature matched, policy allowed",
        ja: "200 · 署名一致、ポリシー許可",
      },
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
          en: "Credential= names ASIA..., so the secret used to recompute comes from the session that X-Amz-Security-Token identifies, together with whatever session policy was attached at issuance, rather than from a stored IAM user key.",
          ja: "Credential= が ASIA... なので、再計算に使う secret は、保管された IAM user のキーではなく、X-Amz-Security-Token が示すセッションから来る。発行時に付いたセッションポリシーも一緒に効く。",
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
          summary: {
            en: "200 · AKIA... + secret, shown once",
            ja: "200 · AKIA... + secret、表示は一度きり",
          },
          headers: [["Content-Type", "text/xml"]],
          body: `<CreateAccessKeyResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
  <CreateAccessKeyResult>
    <AccessKey>
      <UserName>app-user</UserName>
      <AccessKeyId>${LONG_TERM_KEY}</AccessKeyId>
      <SecretAccessKey>${DEMO_SECRET}</SecretAccessKey>
      <Status>Active</Status>
      <CreateDate>2026-09-19T12:00:00Z</CreateDate>
    </AccessKey>
  </CreateAccessKeyResult>
</CreateAccessKeyResponse>`,
          annotations: [
            {
              match: "<CreateDate>2026-09-19T12:00:00Z</CreateDate>",
              tone: "warn",
              note: {
                en: "There is a CreateDate and no expiry to go with it. Age is the only signal you get, which is why key-age reports exist at all.",
                ja: "CreateDate はあるのに、対になる期限が無い。得られる手がかりは経過時間だけ。キーの古さを報告する仕組みが必要になるのはそのため。",
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
            title: { en: "Two per user, and no more", ja: "1ユーザー2本まで" },
            detail: {
              en: "An IAM user can hold two access keys at a time, whether they are Active or Inactive. Asking for a third returns LimitExceeded. Two is what makes rotation possible: create the new one, move traffic, delete the old one.",
              ja: "IAM user が同時に持てるアクセスキーは、Active か Inactive かを問わず2本まで。3本目を要求すると LimitExceeded が返る。2本あることがローテーションを成立させている。新しい方を作り、トラフィックを移し、古い方を消す。",
            },
          },
        ],
      },
      {
        id: "sign-s3",
        phases: ["sign", "verify", "authorize"],
        from: "client",
        to: "service",
        title: {
          en: "Sign an S3 request with it",
          ja: "そのまま S3 リクエストに署名",
        },
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
                en: "S3 rejects a timestamp more than 15 minutes from its own clock with RequestTimeTooSkewed. AWS's general guidance is tighter: in most cases a signed request must arrive within five minutes. Either way the point is to bound how long an intercepted request stays replayable.",
                ja: "S3 は自分の時計から15分以上ずれたタイムスタンプを RequestTimeTooSkewed で拒否する。AWS の一般的な案内はもっと厳しく、多くの場合5分以内に到達する必要がある。どちらにせよ狙いは、傍受されたリクエストが使い回せる時間を区切ること。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          summary: {
            en: "200 · signature matched, policy allowed",
            ja: "200 · 署名一致、ポリシー許可",
          },
          headers: [["x-amz-request-id", "1122334455667788"]],
          body: "hello from s3\n",
        },
        serverSide: [
          {
            title: {
              en: "Look the secret up by key id",
              ja: "key id から secret を引く",
            },
            detail: {
              en: "Credential= names AKIA..., so AWS fetches the stored secret for that IAM user and recomputes. There is no session blob to decrypt.",
              ja: "Credential= が AKIA... なので、その IAM user の保管済み secret を引いて再計算する。復号すべきセッションブロブは存在しない。",
            },
          },
          {
            title: {
              en: "The principal is the user itself",
              ja: "principal はユーザー本人",
            },
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
    credential: {
      en: "ASIA... + secret + session token",
      ja: "ASIA... + secret + session token",
    },
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
        title: {
          en: "Sign a call to sts:AssumeRole",
          ja: "sts:AssumeRole に署名して呼ぶ",
        },
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
          summary: {
            en: "200 · ASIA... + secret + session token",
            ja: "200 · ASIA... + secret + session token",
          },
          headers: [["Content-Type", "text/xml"]],
          body: stsAssumeRoleResponse("AssumeRole"),
          annotations: [
            {
              match: "<Expiration>2026-09-19T13:00:00Z</Expiration>",
              tone: "good",
              note: {
                en: "The difference that matters. DurationSeconds accepts 900 seconds up to the role's MaxSessionDuration, itself settable between 1 and 12 hours, and defaults to 3600. Assume a role from another assumed role and the ceiling drops to one hour regardless.",
                ja: "決定的な差。DurationSeconds は 900 秒からロールの MaxSessionDuration (1〜12時間で設定可能) までで、既定は 3600 秒。assume したロールからさらに assume する (role chaining) と、設定に関係なく上限が1時間に落ちる。",
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
            title: {
              en: "Authenticate the caller first",
              ja: "まず呼び出し元を認証",
            },
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
            title: {
              en: "Mint and encrypt the session",
              ja: "セッションを作って暗号化",
            },
            detail: {
              en: "A fresh secret is generated and packed, with the session's policy and expiry, into the session token blob that the caller will echo back on every request.",
              ja: "新しい secret を生成し、セッションのポリシーと期限とともに session token のブロブに詰める。呼び出し側は以降これを毎リクエスト送り返す。",
            },
          },
        ],
      },
      credentialHandoffStep("use-creds"),
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
        title: {
          en: "Ask GitHub for an ID token",
          ja: "GitHub に ID token を要求",
        },
        narrative: {
          en: "The runner holds a short-lived bearer token that only works inside this job. It exchanges it for a signed JWT naming this exact repository, ref and workflow.",
          ja: "runner はこのジョブの中でしか使えない短命の bearer token を持っている。それを、このリポジトリ・ref・ワークフローを名指しした署名付き JWT に交換する。",
        },
        request: {
          start:
            "GET /_apis/distributedtask/hubs/Actions/plans/PLAN_ID/jobs/JOB_ID/oidctoken?api-version=2.0&audience=sts.amazonaws.com HTTP/1.1",
          headers: [
            ["Host", "pipelinesghubeus.actions.githubusercontent.com"],
            ["Authorization", "Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}"],
          ],
          annotations: [
            {
              match: "&audience=sts.amazonaws.com",
              tone: "key",
              note: {
                en: "Appended with & rather than ?, because ACTIONS_ID_TOKEN_REQUEST_URL already carries a query string. It sets the aud claim, and the trust policy will insist on this exact value. Left unset, aud defaults to the repository owner's URL, which no AWS trust policy expects.",
                ja: "? ではなく & で足す。ACTIONS_ID_TOKEN_REQUEST_URL が既にクエリ文字列を持っているから。これが aud claim を決め、trust policy はこの値をピンポイントで要求する。省略すると aud はリポジトリ所有者の URL が既定値になり、それを期待する AWS の trust policy は存在しない。",
              },
            },
            {
              match: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN}",
              tone: "info",
              note: {
                en: "Injected into the job only when the workflow grants id-token: write. Without that permission neither this variable nor the URL is present, and the step fails before AWS is ever contacted.",
                ja: "ワークフローが id-token: write を与えたときだけジョブに注入される。この権限が無いと変数も URL も存在せず、AWS に触れる前にステップが落ちる。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          summary: {
            en: "200 · signed JWT naming repo and ref",
            ja: "200 · repo と ref を名指しした署名付き JWT",
          },
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
        trustPolicyLab: true,
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
          summary: {
            en: "200 · ASIA..., no AWS credential was sent",
            ja: "200 · ASIA...、AWS クレデンシャルは未送信",
          },
          headers: [["Content-Type", "text/xml"]],
          body: stsAssumeRoleResponse("AssumeRoleWithWebIdentity", {
            role: "GitHubRole",
            session: "gha",
            webIdentity: true,
          }),
          annotations: [
            {
              match:
                "<SubjectFromWebIdentityToken>repo:0-draft/caller-identity:ref:refs/heads/main</SubjectFromWebIdentityToken>",
              tone: "key",
              note: {
                en: "The sub claim, echoed back. This is the only place the federated identity appears in the response; the credentials themselves carry no trace of which repository asked for them.",
                ja: "sub claim がそのまま返ってくる。レスポンス中で federated な身元が現れるのはここだけで、クレデンシャル自体にはどのリポジトリが要求したかの痕跡は残らない。",
              },
            },
            {
              match:
                "<Provider>https://token.actions.githubusercontent.com</Provider>",
              tone: "info",
              note: {
                en: "For an OIDC ID token this holds the iss value. Had an OAuth 2.0 access token been used instead, it would hold the ProviderId sent in the request: the asymmetry is a fossil of the social-login era the parameter name comes from.",
                ja: "OIDC ID token ならここには iss の値が入る。OAuth 2.0 access token を使った場合はリクエストで渡した ProviderId が入る。この非対称性は、パラメータ名の由来であるソーシャルログイン時代の化石。",
              },
            },
          ],
        },
        serverSide: [
          {
            title: {
              en: "Match iss to a registered provider",
              ja: "iss を登録済み provider と照合",
            },
            detail: {
              en: "The issuer must already exist as an IAM OIDC identity provider in the account. An unknown issuer is rejected before any crypto happens.",
              ja: "issuer がアカウント内の IAM OIDC identity provider として既に登録されている必要がある。未知の issuer は暗号検証に入る前に弾かれる。",
            },
          },
          {
            title: {
              en: "Fetch JWKS and verify the signature",
              ja: "JWKS を取得して署名検証",
            },
            detail: {
              en: "AWS reads the provider's /.well-known/openid-configuration, pulls the JWKS, and verifies the JWT signature. No shared secret exists between AWS and GitHub.",
              ja: "provider の /.well-known/openid-configuration を読み、JWKS を取得して JWT の署名を検証する。AWS と GitHub の間に共有秘密は存在しない。",
            },
          },
          {
            title: {
              en: "Check exp, aud, then the trust policy",
              ja: "exp, aud、そして trust policy",
            },
            detail: {
              en: "Expiry and audience first, then the trust policy conditions on token.actions.githubusercontent.com:sub decide whether this particular repository and ref may assume the role.",
              ja: "まず期限と audience、次に token.actions.githubusercontent.com:sub に対する trust policy の条件が、このリポジトリとこの ref に assume を許すかを決める。",
            },
            tone: "good",
          },
        ],
      },
      credentialHandoffStep("use-creds"),
      s3WithTemporaryCredentials("s3-call"),
    ],
  },

  {
    id: "imds",
    title: {
      en: "EC2 instance profile (IMDSv2)",
      ja: "EC2 instance profile (IMDSv2)",
    },
    tagline: {
      en: "Credentials appear out of a link-local address with no call to STS from your code.",
      ja: "自分のコードは STS を呼ばないのに、リンクローカルアドレスからクレデンシャルが降ってくる。",
    },
    credential: {
      en: "ASIA... + secret + session token",
      ja: "ASIA... + secret + session token",
    },
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
        title: {
          en: "Get an IMDSv2 session token",
          ja: "IMDSv2 のセッショントークンを取る",
        },
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
          summary: {
            en: "200 · IMDS session token, 6h max",
            ja: "200 · IMDS セッショントークン、最大6時間",
          },
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
        title: {
          en: "Read the role credentials",
          ja: "ロールのクレデンシャルを読む",
        },
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
          summary: {
            en: "200 · ASIA... + secret + Token, auto-rotated",
            ja: "200 · ASIA... + secret + Token、自動更新",
          },
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
            title: {
              en: "STS already ran, elsewhere",
              ja: "STS は既に別の場所で動いている",
            },
            detail: {
              en: "EC2 obtains credentials for the instance profile's role and rotates them before they expire, so your process never signs an AssumeRole call. The role session exists whether or not anything on the instance ever reads it.",
              ja: "EC2 が instance profile のロールのクレデンシャルを取得し、失効前に自動で入れ替える。だから自分のプロセスは AssumeRole に署名しない。インスタンス上の誰かが読むかどうかに関係なく、ロールセッションは存在している。",
            },
          },
          {
            title: {
              en: "The blast radius is the instance",
              ja: "影響範囲はインスタンス",
            },
            detail: {
              en: "Anything that can make an HTTP request from this host can read these. That is why the hop limit and IMDSv2 enforcement matter.",
              ja: "このホストから HTTP リクエストを出せるものは全部これを読める。hop limit と IMDSv2 強制が効いてくるのはそのため。",
            },
            tone: "warn",
          },
        ],
      },
      credentialHandoffStep("use-creds"),
      s3WithTemporaryCredentials("s3-call"),
    ],
  },

  {
    id: "presigned-url",
    title: { en: "Presigned URL", ja: "presigned URL" },
    tagline: {
      en: "The same signature, moved into the query string, and it becomes a bearer token.",
      ja: "同じ署名をクエリ文字列に移すと、それが bearer token になる。",
    },
    credential: { en: "A URL", ja: "URL そのもの" },
    why: {
      en: "It hands someone a single request they can make on your behalf, without giving them a credential to make any other one.",
      ja: "自分の代わりに実行できるリクエストを1本だけ渡せる。他のリクエストを打てるクレデンシャルは渡さずに。",
    },
    steps: [
      {
        id: "build-url",
        phases: ["sign"],
        from: "client",
        to: "client",
        title: {
          en: "Sign the request into a URL",
          ja: "リクエストを URL に署名する",
        },
        narrative: {
          en: "No network call. The canonical request is built exactly as before, but the auth parameters go into the query string and the payload hash is the literal UNSIGNED-PAYLOAD. What comes out is a string that carries its own authorisation.",
          ja: "通信は発生しない。canonical request の作り方は同じで、認証情報をクエリ文字列に入れ、ペイロードハッシュは文字列 UNSIGNED-PAYLOAD にする。出てくるのは、自分で認可を持ち歩く文字列。",
        },
        presignLab: true,
        serverSide: [
          {
            title: { en: "AWS is not involved yet", ja: "AWS はまだ関与しない" },
            detail: {
              en: "Signing is arithmetic over a string. Nothing is registered with AWS, which is why a presigned URL cannot be revoked individually: only rotating or disabling the underlying credential kills it.",
              ja: "署名は文字列に対する計算でしかない。AWS 側には何も登録されない。だから presigned URL を個別に失効させることはできず、元のクレデンシャルを止める以外に手がない。",
            },
            tone: "warn",
          },
        ],
      },
      {
        id: "anyone-uses-it",
        phases: ["verify", "authorize"],
        from: "external",
        to: "service",
        title: { en: "Anyone holding it calls S3", ja: "持っている人が S3 を呼ぶ" },
        narrative: {
          en: "The caller here is not you. They have no access key, no SDK and no IAM identity of their own. They have a URL, and until it expires that is enough.",
          ja: "ここでの呼び出し元は自分ではない。アクセスキーも SDK も自分の IAM 身元も持っていない。持っているのは URL だけで、期限まではそれで足りる。",
        },
        request: {
          start:
            "GET /key.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA...&X-Amz-Date=20260919T120000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Security-Token=IQoJ...&X-Amz-Signature=... HTTP/1.1",
          headers: [["Host", "my-bucket.s3.us-east-1.amazonaws.com"]],
          annotations: [
            {
              match: "X-Amz-Signature=...",
              tone: "warn",
              note: {
                en: "The only proof of identity in the request, and it is in the URL. URLs end up in browser history, proxy logs, referrer headers and chat messages.",
                ja: "リクエスト中で身元を証明しているのはこれだけで、しかも URL の中にある。URL はブラウザ履歴、プロキシログ、referrer ヘッダ、チャットに残る。",
              },
            },
            {
              match: "X-Amz-Expires=900",
              tone: "key",
              note: {
                en: "The only thing limiting the damage. Everything else about the request was fixed at signing time.",
                ja: "被害を限定している唯一の要素。それ以外は全て署名時点で確定している。",
              },
            },
          ],
        },
        response: {
          start: "HTTP/1.1 200 OK",
          headers: [["Content-Type", "text/plain"]],
          body: "hello from s3\n",
          summary: {
            en: "200 · served to a caller with no IAM identity",
            ja: "200 · IAM 身元を持たない相手に応答",
          },
        },
        serverSide: [
          {
            title: {
              en: "Same verification, different place",
              ja: "同じ検証、違う場所",
            },
            detail: {
              en: "S3 rebuilds the canonical request from the query string rather than the headers, recomputes, and compares. The algorithm is unchanged.",
              ja: "S3 はヘッダではなくクエリ文字列から canonical request を組み立て直し、再計算して照合する。アルゴリズムは変わらない。",
            },
          },
          {
            title: {
              en: "The principal is still you",
              ja: "principal は依然として自分",
            },
            detail: {
              en: "CloudTrail records the identity that signed the URL, not whoever used it. Sharing a presigned URL means actions taken with it are attributed to you.",
              ja: "CloudTrail に残るのは URL に署名した身元で、使った相手ではない。presigned URL を渡すということは、それで行われた操作が自分の名前で記録されるということ。",
            },
            tone: "warn",
          },
        ],
      },
    ],
  },
  {
    id: "sigv4a",
    title: { en: "SigV4a (multi-region)", ja: "SigV4a (複数リージョン)" },
    tagline: {
      en: "Asymmetric signing, so AWS only has to store the public half.",
      ja: "非対称署名。AWS は公開鍵側だけ持てばよくなる。",
    },
    credential: {
      en: "P-256 keypair derived from the secret",
      ja: "secret から導出した P-256 鍵ペア",
    },
    why: {
      en: "A SigV4 signature is scoped to one region by construction. When one request has to be valid in several, the scoping has to move somewhere else.",
      ja: "SigV4 の署名は構造上1リージョンに固定される。1つのリクエストを複数リージョンで有効にするには、その固定をどこか別の場所へ移すしかない。",
    },
    steps: [
      {
        id: "derive-keypair",
        phases: ["sign"],
        from: "client",
        to: "client",
        title: {
          en: "Derive a keypair from the secret",
          ja: "secret から鍵ペアを導出",
        },
        narrative: {
          en: "The same secret access key you already have, run through a counter-mode KDF until the result lands inside the P-256 group order. No new credential is issued and nothing is registered: AWS derives the same public key on its side when it needs to check a signature.",
          ja: "既に持っている secret access key を、結果が P-256 の位数に収まるまで counter モードの KDF に通すだけ。新しいクレデンシャルは発行されず、登録も無い。AWS 側も署名を検証するときに同じ公開鍵を導出する。",
        },
        sigv4aLab: true,
        serverSide: [
          {
            title: {
              en: "Only the public half is stored",
              ja: "保管されるのは公開鍵側だけ",
            },
            detail: {
              en: "This is the structural difference. SigV4 verification needs the shared secret, so every region that verifies must hold it. SigV4a verification needs only the public key, which can be replicated freely.",
              ja: "これが構造上の違い。SigV4 の検証には共有秘密が要るので、検証するリージョン全てがそれを持つ必要がある。SigV4a の検証には公開鍵しか要らず、それは自由に複製できる。",
            },
            tone: "good",
          },
          {
            title: {
              en: "The retry loop is not decorative",
              ja: "リトライは飾りではない",
            },
            detail: {
              en: "A uniformly random 256-bit integer can exceed the group order, and a scalar out of range is not a valid key. The counter increments until one lands in range. In practice the first candidate works.",
              ja: "一様乱数の 256bit 整数は位数を超えうるし、範囲外のスカラーは鍵として無効。範囲に収まるまで counter を増やす。実際には最初の候補で通る。",
            },
          },
        ],
      },
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
        title: {
          en: "Call Bedrock with a bearer token",
          ja: "bearer token で Bedrock を呼ぶ",
        },
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
          summary: {
            en: "200 · model output, nothing was signed",
            ja: "200 · モデル出力、署名は一切なし",
          },
          headers: [["Content-Type", "application/json"]],
          body: `{"output":{"message":{"role":"assistant","content":[{"text":"Hello."}]}}}`,
        },
        serverSide: [
          {
            title: {
              en: "Validate the token server-side",
              ja: "サーバ側でトークンを検証",
            },
            detail: {
              en: "The token is looked up rather than recomputed. Nothing about the request body or headers is covered by it.",
              ja: "再計算ではなく照合。リクエストのボディやヘッダはこのトークンに一切カバーされていない。",
            },
          },
          {
            title: {
              en: "A long-term key hides behind it",
              ja: "背後に長期キーが隠れている",
            },
            detail: {
              en: "Creating a long-term Bedrock API key silently creates an IAM user and attaches AmazonBedrockLimitedAccess to it. Short-term keys inherit the calling principal instead and expire within 12 hours.",
              ja: "long-term の Bedrock API キーを作ると、裏で IAM user が自動生成され AmazonBedrockLimitedAccess が付く。short-term のほうは呼び出し元の権限を継承し、12時間以内に失効する。",
            },
            tone: "warn",
          },
          {
            title: {
              en: "Deny it if you do not need it",
              ja: "使わないなら禁止する",
            },
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
