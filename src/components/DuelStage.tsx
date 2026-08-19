// The visual half of a duel: two fighters with avatars and health bars, plus
// the projectile layer that flies between them.
//
// It is deliberately imperative. DuelArena owns *what happened* (the server
// said: correct, 12 damage); this component owns *what that looks like* and
// exposes a single `fire()` for it. That split is what keeps the arena's game
// logic free of timers, geometry and DOM measurements.
//
// The projectiles are position:fixed and measured from the avatars' own
// bounding boxes at launch time, so they hit where the pictures actually are
// — on a phone, on a wide screen, and after the layout shifted underneath.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flame, WifiOff, Zap, Skull } from 'lucide-react';
import * as duels from '../duels';
import { t, Lang } from '../i18n';

export interface DuelStageHandle {
  // damage 0 means the shot was a miss — it fizzles out mid-flight instead of
  // landing, which is how you notice the opponent got one wrong.
  // Returns how long the shot is in the air (0 when nothing was animated), so
  // the caller can line a sound up with the moment it connects.
  fire: (from: 'me' | 'opponent', damage: number) => number;
}

interface DuelStageProps {
  me: duels.DuelPlayer | null;
  opponent: duels.DuelPlayer | null;
  maxHp: number;
  uiLang: Lang;
  youLabel: string;
}

type Side = 'me' | 'opponent';

interface Projectile {
  id: number;
  x: number; y: number;          // launch point, viewport coordinates
  dx: number; dy: number;        // vector to the target
  angle: number;                 // so trails point backwards along the path
  arc: number;                   // height of the lob
  durationMs: number;
  tier: number;                  // 0 = dud, 1..4 = damage tiers
}

interface Impact {
  id: number;
  x: number; y: number;
  damage: number;
  tier: number;
}

// Heavier shots travel slower and arc higher — a 16-damage combo hit should
// feel like it weighs something next to a plain 10.
const TIERS = [
  { color: '#a1a1aa', duration: 420, arc: 30 },  // 0 — dud
  { color: '#a78bfa', duration: 440, arc: 46 },  // 1 — dart
  { color: '#fb923c', duration: 520, arc: 62 },  // 2 — fireball
  { color: '#22d3ee', duration: 560, arc: 34 },  // 3 — bolt (flatter, faster-looking)
  { color: '#f43f5e', duration: 660, arc: 84 }   // 4 — meteor
];

const tierFor = (damage: number) =>
  damage <= 0 ? 0 : damage >= 16 ? 4 : damage >= 14 ? 3 : damage >= 12 ? 2 : 1;

// Restarting a CSS animation on an element React is going to keep mounted:
// drop the class, force a reflow so the browser registers the removal, add it
// back. Remounting instead (via key) would re-download the Gravatar picture.
function replay(el: HTMLElement | null, className: string) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

const centerOf = (el: HTMLElement | null) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// --- Projectile bodies ---------------------------------------------------

function ProjectileBody({ tier }: { tier: number }) {
  const { color } = TIERS[tier];
  const trail = (width: number, opacity: number) => (
    <span
      className="absolute top-1/2 right-full -translate-y-1/2 rounded-full"
      style={{
        width, height: 3,
        background: `linear-gradient(to left, ${color}, transparent)`,
        opacity
      }}
    />
  );

  if (tier === 0) {
    // A miss: grey, small, and it never reaches the other side.
    return <span className="duel-dud block w-2.5 h-2.5 rounded-full bg-zinc-400/70" />;
  }
  if (tier === 1) {
    return (
      <span className="relative block">
        {trail(34, 0.55)}
        <span
          className="block w-7 h-1.5 rounded-full"
          style={{ background: `linear-gradient(to right, ${color}, #fff)`, boxShadow: `0 0 10px ${color}` }}
        />
      </span>
    );
  }
  if (tier === 2) {
    return (
      <span className="relative block">
        {trail(42, 0.7)}
        <span
          className="block w-4 h-4 rounded-full duel-flicker"
          style={{
            background: 'radial-gradient(circle at 35% 35%, #fff 0%, #fde047 35%, #f97316 70%, rgba(249,115,22,0) 100%)',
            boxShadow: `0 0 18px 5px ${color}`
          }}
        />
      </span>
    );
  }
  if (tier === 3) {
    return (
      <span className="relative block">
        {trail(50, 0.5)}
        <Zap size={24} className="duel-jitter" fill={color} color="#cffafe" style={{ filter: `drop-shadow(0 0 9px ${color})` }} />
      </span>
    );
  }
  return (
    <span className="relative block">
      {trail(64, 0.8)}
      <span className="relative block w-6 h-6">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #fff 0%, #fda4af 30%, #f43f5e 65%, #7f1d1d 100%)',
            boxShadow: `0 0 22px 7px ${color}`
          }}
        />
        <span className="absolute -inset-1 rounded-full border-2 border-rose-300/70 duel-spin" />
      </span>
    </span>
  );
}

// --- Health bar ----------------------------------------------------------

function HealthBar({ hp, maxHp, mirrored }: { hp: number; maxHp: number; mirrored: boolean }) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  // Colour follows what is left, not who owns the bar: "nearly dead" has to
  // read at a glance on either side of the screen.
  const fill = pct > 50 ? 'bg-green-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-3.5 rounded-full bg-zinc-200 dark:bg-[#23202B] overflow-hidden">
      <div
        className={`h-full ${fill} transition-[width] duration-500 ease-out ${mirrored ? 'ml-auto' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// --- Fighter -------------------------------------------------------------

interface FighterProps {
  player: duels.DuelPlayer | null;
  maxHp: number;
  displayHp: number;
  label: string;
  mirrored: boolean;
  uiLang: Lang;
  avatarRef: React.RefObject<HTMLDivElement | null>;
}

function Fighter({ player, maxHp, displayHp, label, mirrored, uiLang, avatarRef }: FighterProps) {
  // Remembering *which* picture failed rather than a boolean means a new
  // avatar is retried automatically, with no effect resetting the flag.
  const [failedHash, setFailedHash] = useState<string | null>(null);
  const hash = player?.avatarHash;

  // d=404 makes Gravatar 404 for addresses it doesn't know, which is what
  // triggers onError and the initials fallback (same trick as the sidebar).
  const src = hash && hash !== failedHash ? `https://www.gravatar.com/avatar/${hash}?d=404&s=160` : null;
  const knockedOut = displayHp <= 0;

  return (
    <div className={`flex-1 min-w-0 flex items-center gap-3 ${mirrored ? 'flex-row-reverse' : ''}`}>
      <div ref={avatarRef} className="relative shrink-0">
        <div
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden shadow-lg ${
            mirrored ? 'shadow-red-500/20' : 'shadow-purple-500/20'
          } ${knockedOut ? 'duel-knockout' : ''}`}
        >
          {src ? (
            <img src={src} onError={() => setFailedHash(hash ?? null)} className="w-full h-full object-cover" alt="" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-white font-bold text-lg bg-gradient-to-tr ${
              mirrored ? 'from-red-500 to-rose-700' : 'from-purple-600 to-indigo-600'
            }`}>
              {(player?.username || '?').substring(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        {knockedOut && (
          <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow-lg">
            <Skull size={26} />
          </span>
        )}
        {(player?.streak ?? 0) >= 2 && !knockedOut && (
          <span className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 text-[10px] font-bold text-white bg-orange-500 px-1.5 py-0.5 rounded-full shadow">
            <Flame size={10} /> {player!.streak}
          </span>
        )}
        {player && !player.connected && !knockedOut && (
          <span title={t(uiLang, 'duelOffline')} className="absolute -bottom-1 -right-1 p-1 rounded-full bg-amber-500 text-white shadow">
            <WifiOff size={10} />
          </span>
        )}
      </div>

      <div className={`flex-1 min-w-0 ${mirrored ? 'text-right' : ''}`}>
        <p className="font-bold text-sm text-zinc-800 dark:text-white truncate mb-1">{label}</p>
        <HealthBar hp={displayHp} maxHp={maxHp} mirrored={mirrored} />
        <p className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-[#9D99A8]">
          <span className="font-bold">{Math.max(0, displayHp)}</span>
          <span className="opacity-60"> / {maxHp}</span>
        </p>
      </div>
    </div>
  );
}

// --- Stage ---------------------------------------------------------------

const DuelStage = forwardRef<DuelStageHandle, DuelStageProps>(function DuelStage(
  { me, opponent, maxHp, uiLang, youLabel }, ref
) {
  const meAvatar = useRef<HTMLDivElement>(null);
  const opponentAvatar = useRef<HTMLDivElement>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [vignette, setVignette] = useState(0);
  const nextId = useRef(1);
  // Guards against a server-side render (there is none in the app itself, but
  // the components are rendered headlessly in tests): createPortal needs a DOM.
  const canPortal = typeof document !== 'undefined';

  // The bars trail the real values: a hit registers with the server long
  // before its projectile lands, and draining health *before* the shot
  // connects would give the punchline away. flightUntil holds that back.
  const realMeHp = me?.hp ?? maxHp;
  const realOpponentHp = opponent?.hp ?? maxHp;
  const [displayHp, setDisplayHp] = useState({ me: realMeHp, opponent: realOpponentHp });
  const flightUntil = useRef(0);

  useEffect(() => {
    const delay = Math.max(0, flightUntil.current - Date.now());
    const id = setTimeout(() => setDisplayHp({ me: realMeHp, opponent: realOpponentHp }), delay);
    return () => clearTimeout(id);
  }, [realMeHp, realOpponentHp]);

  const fire = useCallback((from: Side, damage: number): number => {
    const source = centerOf(from === 'me' ? meAvatar.current : opponentAvatar.current);
    const target = centerOf(from === 'me' ? opponentAvatar.current : meAvatar.current);
    // No layout to measure (the stage is off-screen, or this fired during a
    // transition) — the health bars still update, there is just no animation.
    if (!source || !target) return 0;

    const tier = tierFor(damage);
    const { duration, arc } = TIERS[tier];
    const full = { dx: target.x - source.x, dy: target.y - source.y };
    // A dud never arrives: it covers 45% of the distance and gives up.
    const reach = tier === 0 ? 0.45 : 1;
    const id = nextId.current++;

    setProjectiles(prev => [...prev, {
      id,
      x: source.x, y: source.y,
      dx: full.dx * reach, dy: full.dy * reach,
      angle: (Math.atan2(full.dy, full.dx) * 180) / Math.PI,
      arc, durationMs: duration, tier
    }]);

    replay(from === 'me' ? meAvatar.current : opponentAvatar.current, 'duel-recoil');
    if (tier > 0) flightUntil.current = Math.max(flightUntil.current, Date.now() + duration);

    window.setTimeout(() => {
      setProjectiles(prev => prev.filter(p => p.id !== id));
      if (tier === 0) return;

      // Landing: the target shakes, the burst goes off where the picture is
      // *now* (it may have moved during the flight), the bars catch up.
      const hitPoint = centerOf(from === 'me' ? opponentAvatar.current : meAvatar.current) || target;
      replay(from === 'me' ? opponentAvatar.current : meAvatar.current, 'duel-shake');
      setImpacts(prev => [...prev, { id, x: hitPoint.x, y: hitPoint.y, damage, tier }]);
      if (from === 'opponent') setVignette(v => v + 1);
      window.setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== id)), 1200);
    }, duration);

    // The bars are *not* touched here — the effect above owns that, and it
    // waits for flightUntil, so health and impact land in the same frame.
    return tier === 0 ? 0 : duration;
  }, []);

  useImperativeHandle(ref, () => ({ fire }), [fire]);

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-4">
        <Fighter
          player={me} maxHp={maxHp} displayHp={displayHp.me} label={youLabel}
          mirrored={false} uiLang={uiLang} avatarRef={meAvatar}
        />
        <span className="shrink-0 text-[10px] font-bold tracking-[0.2em] text-zinc-300 dark:text-zinc-600 select-none">VS</span>
        <Fighter
          player={opponent} maxHp={maxHp} displayHp={displayHp.opponent} label={opponent?.username || '—'}
          mirrored uiLang={uiLang} avatarRef={opponentAvatar}
        />
      </div>

      {/* Everything below is pure decoration in the top layer — pointer-events
          are off throughout, so a projectile can never swallow a click on the
          answer underneath it. It hangs off <body> rather than off this
          subtree because the arena's sticky header uses backdrop-blur, and a
          backdrop-filter ancestor becomes the containing block for
          position:fixed children — which would offset every coordinate we
          just measured against the viewport. */}
      {canPortal && createPortal(<>
      {projectiles.map(p => (
        <div
          key={p.id}
          className="duel-projectile"
          style={{
            left: p.x, top: p.y,
            ['--dx' as string]: `${p.dx}px`,
            ['--dy' as string]: `${p.dy}px`,
            ['--dur' as string]: `${p.durationMs}ms`
          }}
        >
          <div className="duel-projectile-arc" style={{ ['--arc' as string]: `${p.arc}px` }}>
            <div className="duel-projectile-body" style={{ ['--angle' as string]: `${p.angle}deg` }}>
              <ProjectileBody tier={p.tier} />
            </div>
          </div>
        </div>
      ))}

      {impacts.map(impact => (
        <div key={impact.id}>
          <div
            className="duel-impact duel-burst rounded-full border-2"
            style={{
              left: impact.x - 32, top: impact.y - 32, width: 64, height: 64,
              borderColor: TIERS[impact.tier].color,
              boxShadow: `0 0 26px 6px ${TIERS[impact.tier].color}`
            }}
          />
          {[...Array(7)].map((_, i) => (
            <div
              key={i}
              className="duel-impact duel-shard rounded-full"
              style={{
                left: impact.x, top: impact.y, width: 6, height: 6,
                background: TIERS[impact.tier].color,
                ['--shard-angle' as string]: `${(360 / 7) * i + impact.id * 13}deg`,
                ['--shard-dist' as string]: `${34 + impact.tier * 9}px`
              }}
            />
          ))}
          <div
            className="duel-impact duel-damage font-extrabold text-2xl tabular-nums"
            style={{ left: impact.x, top: impact.y - 38, color: TIERS[impact.tier].color, textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
          >
            −{impact.damage}
          </div>
        </div>
      ))}

      {/* Taking a hit dims the edges of the screen for half a second. */}
      {vignette > 0 && (
        <div
          key={vignette}
          className="duel-vignette fixed inset-0 z-[55] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(244,63,94,0) 45%, rgba(244,63,94,0.42) 100%)' }}
        />
      )}
      </>, document.body)}
    </>
  );
});

export default DuelStage;
