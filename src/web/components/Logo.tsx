// Inline spear mark for the header — uses currentColor so it inherits the
// brand's phosphor green (and the CSS glow).
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand-logo"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M512 150 C 574 234 600 302 600 350 C 600 394 558 418 512 426 C 466 418 424 394 424 350 C 424 302 450 234 512 150 Z" />
      <path d="M495 421 L529 421 L521 466 L503 466 Z" />
      <rect x="501" y="458" width="22" height="424" rx="11" />
      <rect x="493" y="876" width="38" height="16" rx="8" />
    </svg>
  );
}
