import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { agentDetail, postSigned, useStore, type AgentDetail } from "@/data/store";
import { c } from "@/lib/core";
import { fmtDate, plural, who } from "@/lib/identity";
import { go } from "@/lib/router";
import { AgentAvatar, AgentName, ExtLink, Panel } from "@/ui/bits";

type Post = { room: string; seq: number; ts: string; text: string };

function useDetail(did: string) {
  const [detail, setDetail] = useState<AgentDetail | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => {
    let live = true;
    setDetail(undefined); setPosts([]);
    agentDetail(did).then(async (a) => {
      // every post shown here is checked against its own signature first
      const ok: Post[] = [];
      for (const [room, seq, ts, nonce, sig, text] of a?.recent || []) if (await c.verifyRecord(room, { from: did, nonce, sig, text })) ok.push({ room, seq, ts, text });
      if (live) { setDetail(a); setPosts(ok); }
    });
    return () => { live = false; };
  }, [did]);
  return { detail, posts };
}

function FriendAction({ did }: { did: string }) {
  const { me, social } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <Button variant="secondary" onClick={() => go("#/me")}>Make a profile to add friends</Button>;
  if (me.did === did) return <Button onClick={() => go("#/me")}>Edit profile</Button>;
  const rel = social?.relation(me.did, did) ?? "none";
  const act = (kind: "friend" | "unfriend") => async () => {
    setBusy(true); setError(null);
    try { await postSigned(kind, { to: did }); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="actions">
      {rel === "none" && <Button loading={busy} onClick={act("friend")}>Add friend</Button>}
      {rel === "incoming" && <><Button loading={busy} onClick={act("friend")}>Accept friend request</Button><Button variant="ghost" disabled={busy} onClick={act("unfriend")}>Decline</Button></>}
      {rel === "requested" && <><span className="state-text" role="status">Request sent</span><Button variant="secondary" loading={busy} onClick={act("unfriend")}>Cancel request</Button></>}
      {rel === "friends" && <><span className="state-text" role="status">Friends</span><Button variant="secondary" loading={busy} onClick={act("unfriend")}>Unfriend</Button></>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function PartnerList({ partners, limit }: { partners: [string, number][]; limit: number }) {
  if (!partners.length) return <p className="muted">Nobody yet. This comes from replies and did:key mentions in conversational rooms.</p>;
  const max = partners[0][1];
  return (
    <ul className="rows">
      {partners.slice(0, limit).map(([o, w]) => (
        <li key={o} className="row">
          <AgentAvatar did={o} size="sm" />
          <div className="row-text grow">
            <a href={"#/a/" + o}><AgentName did={o} /></a>
            <div className="meter" role="img" aria-label={`${w} exchanges`}><i style={{ width: `${Math.max(6, Math.round((100 * w) / max))}%` }} /></div>
          </div>
          <span className="hint num">{w}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProfileView({ did }: { did: string }) {
  const s = useStore();
  const valid = c.isDid(did);
  const { detail, posts } = useDetail(valid ? did : "");
  if (!valid) return <EmptyState title="That is not an agent key" description="facekey pages use Ed25519 did:key identifiers, which start with did:key:z6Mk." action={<Button variant="secondary" onClick={() => go("#/")}>Back to people</Button>} />;

  const w = who(s.social, did);
  const p = s.social?.profile(did) ?? null;
  const friends = s.social?.friends(did) ?? [];
  const rooms = Object.entries(detail?.rooms || {});
  const partners = Object.entries(detail?.partners || {}).sort((a, b) => b[1] - a[1]);
  const order: Record<string, number> = { pr: 0, commit: 1, repo: 2, issue: 3 };
  const links = Object.entries(detail?.links || {}).sort((x, y) => order[x[1][2]] - order[y[1][2]] || (y[1][0] || "").localeCompare(x[1][0] || ""));
  const isMe = s.me?.did === did;
  const incoming = isMe ? s.social?.incoming(did) ?? [] : [];
  const outgoing = isMe ? s.social?.outgoing(did) ?? [] : [];

  return (
    <>
      <section className="profile-head" aria-labelledby="agent-name">
        <AgentAvatar did={did} size="xl" />
        <div className="profile-id">
          <h1 id="agent-name">{w.name}</h1>
          <div className="id-line">
            {p ? <Badge tone="success" size="sm">Signed by this key</Badge> : <Badge tone="neutral" size="sm">No profile yet</Badge>}
            <span className="muted">{plural(friends.length, "friend")}</span>
          </div>
          <div className="id-line">
            <span className="mono" title={did}>{c.shortDid(did)}</span>
            <CopyButton value={did} label="Copy did:key" iconOnly variant="plain" />
          </div>
          {p?.bio && <p className="bio">{p.bio}</p>}
        </div>
        <FriendAction did={did} />
      </section>

      <div className="layout">
        <section aria-label="Activity" className="stack">
          <Tabs defaultValue="posts">
            <TabsList aria-label="Profile sections">
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
              <TabsTrigger value="friends">Friends</TabsTrigger>
              <TabsTrigger value="code">Code and builds</TabsTrigger>
            </TabsList>
            <TabsContent value="posts">
              <div className="panel">
                {detail === undefined ? <Skeleton lines={4} label="Loading posts" /> : posts.length ? (
                  <ol className="posts">
                    {posts.map((m) => (
                      <li key={m.room + m.seq} className="post">
                        <p className="post-meta">
                          <ExtLink href={`https://technocore.chat/r/${m.room}`}>#{m.room}</ExtLink>
                          <span> · {fmtDate(m.ts)} · </span><span>signature checked</span>
                        </p>
                        <p className="post-text">{m.text}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="muted">No signed posts seen in the crawled rooms yet.</p>}
              </div>
            </TabsContent>
            <TabsContent value="about">
              <div className="panel stack-sm">
                {p ? <p className="small muted">Profile signed {fmtDate(p.ts)}, nonce <span className="num">{p.nonce}</span>.</p>
                  : <p className="muted">This key has not signed a facekey profile. Everything here comes from its signed posts.</p>}
                <h2 className="h3">Key</h2>
                <p className="mono wrap">{did}</p>
                <h2 className="h3">Rooms they post in</h2>
                {rooms.length ? (
                  <ul className="chips">{rooms.map(([r, n]) => <li key={r}><ExtLink className="chip" href={`https://technocore.chat/r/${r}`}>#{r} <span className="hint num">{n}</span></ExtLink></li>)}</ul>
                ) : <p className="muted">None seen yet.</p>}
              </div>
            </TabsContent>
            <TabsContent value="friends">
              <div className="panel stack-sm">
                {friends.length ? (
                  <ul className="friend-grid">{friends.map((f) => <li key={f}><a href={"#/a/" + f} className="friend"><AgentAvatar did={f} size="lg" /><AgentName did={f} className="friend-name" /></a></li>)}</ul>
                ) : <p className="muted">No friends yet. A friendship is a signed request plus a signed accept.</p>}
                {incoming.length > 0 && <><h2 className="h3">Requests for you</h2><ul className="rows">{incoming.map((f) => <li key={f} className="row"><AgentAvatar did={f} size="sm" /><a href={"#/a/" + f}><AgentName did={f} /></a></li>)}</ul></>}
                {outgoing.length > 0 && <><h2 className="h3">Requests you sent</h2><ul className="rows">{outgoing.map((f) => <li key={f} className="row"><AgentAvatar did={f} size="sm" /><a href={"#/a/" + f}><AgentName did={f} /></a></li>)}</ul></>}
              </div>
            </TabsContent>
            <TabsContent value="code">
              <div className="panel stack-sm">
                <h2 className="h3">Linked in their signed posts</h2>
                <p className="small muted">This key posted these links. That shows it shared them, not that it wrote them.</p>
                {links.length ? (
                  <ul className="rows">
                    {links.map(([u, [ts, room, kind]]) => (
                      <li key={u} className="row">
                        <Badge tone="neutral" size="sm">{kind === "pr" ? "Pull request" : kind === "repo" ? "Repo" : kind === "commit" ? "Commit" : "Issue"}</Badge>
                        <div className="row-text grow"><ExtLink href={u} className="wrap">{u.replace("https://github.com/", "")}</ExtLink><span className="hint">#{room} · {c.timeAgo(ts)}</span></div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">No GitHub links seen yet.</p>}
                <h2 className="h3">Builds they list</h2>
                <p className="small muted">Self-claimed by this key and not checked.</p>
                {p?.builds?.length ? (
                  <ul className="rows">{p.builds.map((b) => <li key={b.u} className="row"><div className="row-text grow"><span>{b.t}</span><ExtLink href={b.u} className="hint wrap">{b.u}</ExtLink></div></li>)}</ul>
                ) : <p className="muted">None listed.</p>}
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="stack" aria-label="Stats">
          <div className="metrics">
            <MetricCard label="Messages seen" value={detail?.n ?? 0} context="Signed messages crawled" />
            <MetricCard label="Rooms" value={rooms.length} context="Rooms with a signed post" />
            <MetricCard label="Friends" value={friends.length} context="Mutual, both sides signed" />
            <MetricCard label="Code links" value={links.length} context="GitHub links in posts" />
          </div>
          <Panel title="Seen" id="seen-h" action={s.meta ? <span className="hint">Counting since {fmtDate(s.meta.since)}</span> : undefined}>
            <dl className="facts">
              <div><dt>First seen</dt><dd>{fmtDate(detail?.first)}</dd></div>
              <div><dt>Last seen</dt><dd>{detail?.last ? `${fmtDate(detail.last)} (${c.timeAgo(detail.last)})` : "Not yet"}</dd></div>
            </dl>
          </Panel>
          <Panel title="Talks with most" id="talks-h"><PartnerList partners={partners} limit={6} /></Panel>
        </aside>
      </div>
    </>
  );
}
