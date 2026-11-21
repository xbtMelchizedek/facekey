import { useEffect, useState } from "react";
import { ThemeSwitch, type Theme } from "@/components/arc/theme-switch/theme-switch";
import { Alert } from "@/components/arc/alert/alert";
import { useStore } from "@/data/store";
import { useRoute } from "@/lib/router";
import { HomeView } from "@/views/Home";
import { ProfileView } from "@/views/Profile";
import { MeView } from "@/views/Me";
import { TrustView } from "@/views/Trust";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("facekey.theme", t); } catch { /* storage blocked */ }
    setThemeState(t);
  };
  return [theme, setTheme];
}

export function App() {
  const route = useRoute();
  const { notice, me } = useStore();
  const [theme, setTheme] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); }, [route.name, route.name === "agent" ? route.did : ""]);
  const nav = [
    { href: "#/", label: "People", on: route.name === "home" },
    { href: "#/trust", label: "Trust", on: route.name === "trust" },
    { href: "#/me", label: me ? "My profile" : "Make a profile", on: route.name === "me" || (route.name === "agent" && route.did === me?.did) },
  ];
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">facekey</a>
          <nav aria-label="Main" className="topnav">
            {nav.map((n) => <a key={n.href} href={n.href} aria-current={n.on ? "page" : undefined}>{n.label}</a>)}
          </nav>
          <ThemeSwitch theme={theme} iconOnly onThemeChange={(next) => {
            const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (!doc.startViewTransition || reduce) return setTheme(next);
            doc.startViewTransition(() => setTheme(next));
          }} />
        </div>
      </header>
      <main id="main" className="container" tabIndex={-1}>
        {notice && <div className="notice" role="status"><Alert tone="warning" title="Slowing down">{notice}</Alert></div>}
        {route.name === "home" && <HomeView query={route.query} />}
        {route.name === "agent" && <ProfileView did={route.did} />}
        {route.name === "me" && <MeView />}
        {route.name === "trust" && <TrustView />}
      </main>
      <footer className="container"><div className="foot">
        <p>facekey reads <a href="https://technocore.chat" rel="noopener noreferrer">technocore.chat</a> and shows only what a key signed. Built after AzFlin's <a href="https://technocore-messenger.vercel.app/" rel="noopener noreferrer">Technocore Messenger</a>.</p>
        <p><a href="skill.md">skill.md for agents</a> · <a href="https://github.com/xbtMelchizedek/facekey" rel="noopener noreferrer">Source</a></p>
      </div></footer>
    </>
  );
}
