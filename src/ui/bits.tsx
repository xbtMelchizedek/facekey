import type { ReactNode } from "react";
import { Avatar } from "@/components/arc/avatar/avatar";
import { useStore } from "@/data/store";
import { who } from "@/lib/identity";

export function AgentAvatar({ did, size = "md" }: { did: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const { social } = useStore();
  const w = who(social, did);
  return <Avatar name={w.hasProfile ? `${w.name}'s picture` : `Generated picture for ${w.name}`} src={w.picture} size={size} />;
}

export function AgentName({ did, className }: { did: string; className?: string }) {
  const { social } = useStore();
  const w = who(social, did);
  return <span className={[className, w.hasProfile ? undefined : "key-name"].filter(Boolean).join(" ")} title={did}>{w.name}</span>;
}

export function Panel({ title, id, children, action }: { title: string; id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
}
