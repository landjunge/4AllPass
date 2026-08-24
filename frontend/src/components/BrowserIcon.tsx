/**
 * Recognizable product marks for the browser cards. Letter-circles are not
 * these browsers.
 */
import { useId, type ReactNode } from "react";

const KNOWN = [
  "chrome",
  "chrome-canary",
  "chromium",
  "brave",
  "edge",
  "arc",
  "vivaldi",
  "opera",
  "opera-gx",
  "firefox",
  "firefox-developer",
  "firefox-nightly",
  "safari",
] as const;

export type BrowserIconId = (typeof KNOWN)[number];

export function browserIconVariant(id: string): BrowserIconId | "fallback" {
  return (KNOWN as readonly string[]).includes(id) ? (id as BrowserIconId) : "fallback";
}

export function BrowserIcon({ id, name }: { id: string; name: string }): ReactNode {
  const uid = useId().replace(/:/g, "");
  const variant = browserIconVariant(id);
  return (
    <svg
      viewBox="0 0 32 32"
      className="browser-icon"
      role="img"
      aria-label={name}
      data-testid={`browser-icon-${id}`}
      data-variant={variant}
    >
      {mark(variant, uid, name)}
    </svg>
  );
}

function mark(variant: BrowserIconId | "fallback", uid: string, name: string): ReactNode {
  switch (variant) {
    case "chrome":
    case "chrome-canary":
      return <ChromeMark uid={uid} canary={variant === "chrome-canary"} />;
    case "chromium":
      return <ChromiumMark />;
    case "brave":
      return <BraveMark />;
    case "edge":
      return <EdgeMark uid={uid} />;
    case "arc":
      return <ArcMark uid={uid} />;
    case "vivaldi":
      return <VivaldiMark />;
    case "opera":
    case "opera-gx":
      return <OperaMark gx={variant === "opera-gx"} />;
    case "firefox":
    case "firefox-developer":
    case "firefox-nightly":
      return (
        <FirefoxMark
          night={variant === "firefox-nightly"}
          dev={variant === "firefox-developer"}
        />
      );
    case "safari":
      return <SafariMark />;
    default:
      return <FallbackMark name={name} />;
  }
}

function ChromeMark({ uid, canary }: { uid: string; canary: boolean }): ReactNode {
  const clip = `${uid}-chrome`;
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <circle cx="16" cy="16" r="15" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <path fill="#EA4335" d="M16 16 L16 1 A15 15 0 0 1 28.99 23.5 Z" />
        <path fill="#34A853" d="M16 16 L28.99 23.5 A15 15 0 0 1 3.01 23.5 Z" />
        <path fill="#FBBC04" d="M16 16 L3.01 23.5 A15 15 0 0 1 16 1 Z" />
      </g>
      <circle cx="16" cy="16" r="8.2" fill="#fff" />
      <circle cx="16" cy="16" r="5.6" fill="#4285F4" />
      {canary ? <circle cx="25" cy="7" r="4.2" fill="#F6BE00" stroke="#1a1a1a" strokeWidth="0.6" /> : null}
    </>
  );
}

function ChromiumMark(): ReactNode {
  return (
    <>
      <circle cx="16" cy="16" r="15" fill="#3C7EF3" />
      <circle cx="16" cy="16" r="7.5" fill="#fff" />
      <circle cx="16" cy="16" r="5" fill="#3C7EF3" />
      <circle cx="16" cy="6.5" r="2.2" fill="#fff" />
    </>
  );
}

function BraveMark(): ReactNode {
  return (
    <>
      <path
        fill="#FB542B"
        d="M16 2.5 L26.5 7.2 L25.2 18.8 C24.5 25.2 16 29.5 16 29.5 C16 29.5 7.5 25.2 6.8 18.8 L5.5 7.2 Z"
      />
      <path
        fill="#fff"
        d="M11.2 8.2 L16 6.4 L20.8 8.2 L19.7 13.4 L16 12.2 L12.3 13.4 Z"
      />
      <path fill="#FB542B" d="M13.2 16.2 L16 15.1 L18.8 16.2 L16 22.4 Z" />
    </>
  );
}

function EdgeMark({ uid }: { uid: string }): ReactNode {
  const g = `${uid}-edge`;
  return (
    <>
      <defs>
        <linearGradient id={g} x1="6" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#36C5F0" />
          <stop offset="1" stopColor="#0C63D6" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${g})`}
        d="M16 3c7.2 0 13 5.8 13 13 0 2.4-.6 4.6-1.7 6.6C25.6 16.2 21 12 15.2 12c-5.4 0-9.2 3.6-9.2 8.1 0 4.8 4.2 7.9 10 7.9 5.4 0 9.4-2.4 11.5-6.2A13 13 0 1 1 16 3Z"
      />
      <path
        fill="#fff"
        fillOpacity="0.92"
        d="M8.2 20.4c.4-3.4 3.6-5.8 7.6-5.8 5.4 0 9.4 3.7 10.4 8.6-1.9 3.4-5.6 5.4-10.2 5.4-4.8 0-8.2-2.5-7.8-8.2Z"
      />
    </>
  );
}

function ArcMark({ uid }: { uid: string }): ReactNode {
  const g = `${uid}-arc`;
  return (
    <>
      <defs>
        <linearGradient id={g} x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6C445" />
          <stop offset="0.35" stopColor="#E85D4C" />
          <stop offset="0.7" stopColor="#9B5CFF" />
          <stop offset="1" stopColor="#3D8BFF" />
        </linearGradient>
      </defs>
      <path
        fill="none"
        stroke={`url(#${g})`}
        strokeWidth="5"
        strokeLinecap="round"
        d="M8 24.5 A10.5 10.5 0 1 1 24.5 8"
      />
    </>
  );
}

function VivaldiMark(): ReactNode {
  return (
    <>
      <circle cx="16" cy="16" r="15" fill="#EF3939" />
      <path
        fill="#fff"
        d="M8.2 11.2c2.6 0 4.1 2.2 4.9 4.6.8-2.4 2.3-4.6 4.9-4.6 1.2 0 2 .4 2.6 1L16 23.8 5.6 12.2c.7-.6 1.5-1 2.6-1Z"
      />
    </>
  );
}

function OperaMark({ gx }: { gx: boolean }): ReactNode {
  return (
    <>
      <circle cx="16" cy="16" r="15" fill={gx ? "#1a1a1a" : "#FF1B2D"} />
      <ellipse cx="16" cy="16" rx="6.4" ry="10.2" fill={gx ? "#FF1B2D" : "#fff"} />
      <ellipse cx="16" cy="16" rx="3.4" ry="10.2" fill={gx ? "#1a1a1a" : "#FF1B2D"} />
      {gx ? <circle cx="24.5" cy="7.5" r="3.6" fill="#7CFF6B" /> : null}
    </>
  );
}

function FirefoxMark({ night, dev }: { night: boolean; dev: boolean }): ReactNode {
  const bg = night ? "#20123A" : dev ? "#0A84FF" : "#20123A";
  return (
    <>
      <circle cx="16" cy="16" r="15" fill={bg} />
      <path
        fill="#FF7139"
        d="M6.4 18.6c1.4-6.6 6-11.4 12.4-12.2 1.2 2.4-.2 4.6-1.8 5.4 3.6-.2 7.2 2 8.4 5.6.2 3.2-1.4 6.4-4.6 8.2-4.8 2.6-10.6.8-13.2-3.2 2.6.8 4.8.4 5.6-1.2-3.2-.2-6.2-2.8-6.8-2.6Z"
      />
      <path
        fill="#FFD150"
        d="M11.6 16.4c1.4-2.2 4.2-3.2 6.4-1.8 1.6 2.2.4 5.2-2.2 6.2-2.4.6-4.8-1.2-4.2-4.4Z"
      />
    </>
  );
}

function SafariMark(): ReactNode {
  return (
    <>
      <circle cx="16" cy="16" r="15" fill="#1C8CFF" />
      <circle cx="16" cy="16" r="12.2" fill="#F4F7FB" />
      {[0, 45, 90, 135].map((deg) => (
        <rect
          key={deg}
          x="15.3"
          y="5.2"
          width="1.4"
          height="21.6"
          rx="0.5"
          fill="#8AA0B8"
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
      <path fill="#FF3B30" d="M16 7.2 L18.6 16 L16 16 Z" />
      <path fill="#F4F7FB" d="M16 24.8 L13.4 16 L16 16 Z" />
      <circle cx="16" cy="16" r="1.3" fill="#1C8CFF" />
    </>
  );
}

function FallbackMark({ name }: { name: string }): ReactNode {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <>
      <circle cx="16" cy="16" r="15" fill="#3A4150" />
      <text x="16" y="21" textAnchor="middle" fill="#F4F7FB" fontSize="14" fontWeight="700">
        {letter}
      </text>
    </>
  );
}
