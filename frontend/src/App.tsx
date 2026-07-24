import { useEffect, useState } from "react";
import { ArrowRight, Check, Clapperboard, Scissors, Sparkles, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VideoUpload } from "@/components/VideoUpload";
import { getHealth } from "@/lib/api";

export default function App() {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  useEffect(() => { getHealth().then(() => setHealth("online")).catch(() => setHealth("offline")); }, []);
  return <main className="relative min-h-screen overflow-hidden"><div className="grid-fade pointer-events-none absolute inset-0 h-[720px]"/>
    <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-6 lg:px-8"><a className="flex items-center gap-2.5 font-semibold" href="#"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary"><Scissors size={18}/></span>SmartClip</a><a href="#upload"><Button variant="outline">Upload video <ArrowRight size={15}/></Button></a></nav>
    <section className="relative mx-auto max-w-5xl px-5 pb-12 pt-16 text-center sm:pt-24"><div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-violet-300"><Sparkles size={13}/> Intelligent editing. Zero AI APIs.</div><h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-[-.045em] sm:text-7xl lg:text-[88px]">Find the moments<br/><span className="bg-gradient-to-r from-violet-400 via-indigo-300 to-cyan-300 bg-clip-text text-transparent">worth sharing.</span></h1><p className="mx-auto mt-7 max-w-2xl text-pretty leading-7 text-muted-foreground sm:text-lg">Start with a local video. SmartClip validates it and reads its media details while your temporary upload stays under your control.</p><a href="#upload"><Button className="mt-8" size="lg">Upload footage <ArrowRight size={17}/></Button></a><div className="mt-7 flex justify-center"><span className="inline-flex items-center gap-2 text-xs text-muted-foreground">{health === "online" ? <Wifi className="text-emerald-400" size={14}/> : health === "offline" ? <WifiOff className="text-rose-400" size={14}/> : <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400"/>} Backend {health}</span></div></section>
    <VideoUpload />
    <section className="mx-auto max-w-4xl px-5 py-20"><Card className="relative overflow-hidden p-8 sm:p-12"><div className="relative grid gap-8 sm:grid-cols-2"><div><Clapperboard className="mb-5 text-violet-400"/><h2 className="text-3xl font-semibold">Local by design.</h2><p className="mt-4 leading-7 text-muted-foreground">Your source is held only long enough for your editing session.</p></div><div className="grid content-center gap-3">{["Validated video formats","Metadata powered by FFmpeg","Unique, traversal-safe storage","Automatic temporary cleanup"].map(x=><div key={x} className="flex items-center gap-3 text-sm"><Check className="text-emerald-400" size={16}/>{x}</div>)}</div></div></Card></section>
    <footer className="mx-auto flex max-w-7xl justify-between border-t border-border px-5 py-8 text-xs text-muted-foreground"><span>© 2026 SmartClip</span><span>Built for creators.</span></footer>
  </main>;
}
