// Bold layered cut-paper SVG illustrations in SEU ink-green, sage, warm cream, and ginkgo ochre.
import { useId } from "react";

/**
 * Bold layered papercut diorama for the ink-green editorial masthead:
 * overlapping cream/ochre/sage paper planes, SEU auditorium dome silhouette,
 * cut-out archways, and layered ginkgo & botanical leaves with real paper-shadow depth.
 */
export function MastheadPaperArt({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg width="260" height="128" viewBox="0 0 260 128" fill="none" aria-hidden="true" className={`shrink-0 select-none ${className}`}>
      <defs>
        <filter id={`${id}-deep`} x="-12%" y="-12%" width="130%" height="136%">
          <feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor="#041c15" floodOpacity="0.34" />
        </filter>
        <filter id={`${id}-mid`} x="-12%" y="-12%" width="130%" height="136%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodColor="#06251c" floodOpacity="0.28" />
        </filter>
      </defs>

      {/* Layer 1: Warm ochre paper sun/moon disc */}
      <g filter={`url(#${id}-deep)`}>
        <circle cx="196" cy="44" r="34" fill="#E8CA7A" />
        <circle cx="196" cy="44" r="26" fill="#F2D995" />
      </g>

      {/* Layer 2: Back sage paper hill & folded editorial card */}
      <g filter={`url(#${id}-deep)`}>
        <path d="M18 122C42 74 90 54 146 64C186 71 218 54 252 38V128H18V122Z" fill="#176951" />
        <rect x="26" y="20" width="76" height="58" rx="9" transform="rotate(-7 26 20)" fill="#F6EFDC" />
        {/* Folded editorial lines on the cream sheet */}
        <rect x="40" y="34" width="32" height="4.5" rx="2.25" transform="rotate(-7 40 34)" fill="#0E5240" fillOpacity="0.72" />
        <rect x="42" y="45" width="46" height="3" rx="1.5" transform="rotate(-7 42 45)" fill="#8E7944" fillOpacity="0.45" />
        <rect x="43.5" y="53" width="38" height="3" rx="1.5" transform="rotate(-7 43.5 53)" fill="#8E7944" fillOpacity="0.36" />
      </g>

      {/* Layer 3: SEU Grand Auditorium inspired cut-paper dome & colonnade */}
      <g filter={`url(#${id}-deep)`}>
        {/* Dome */}
        <path d="M126 56C126 36 144 22 166 22C188 22 206 36 206 56H126Z" fill="#F7F1E1" />
        {/* Dome rib crease */}
        <path d="M166 22V56" stroke="#D8C9A2" strokeWidth="1.5" />
        <circle cx="166" cy="18" r="4" fill="#E5BE62" />
        {/* Pediment & facade */}
        <rect x="116" y="56" width="100" height="10" rx="2.5" fill="#E9DFC5" />
        <rect x="122" y="66" width="88" height="56" rx="4" fill="#FBF7EC" />
        {/* Cut-out deep green archways */}
        <path d="M134 122V86C134 80 139 76 144.5 76C150 76 155 80 155 86V122H134Z" fill="#0D4B3A" />
        <path d="M160 122V84C160 77 166 72 172.5 72C179 72 185 77 185 84V122H160Z" fill="#0A3A2D" />
        <path d="M190 122V86C190 80 195 76 200.5 76C206 76 210 80 210 86V122H190Z" fill="#0D4B3A" />
      </g>

      {/* Layer 4: Foreground cut-paper botanical & ginkgo fan leaves */}
      <g filter={`url(#${id}-mid)`}>
        {/* Left layered sage leaf */}
        <path d="M64 124C64 90 84 68 118 64C112 96 92 118 64 124Z" fill="#329472" />
        <path d="M64 124C80 100 98 82 118 64" stroke="#BFE8D6" strokeWidth="1.5" strokeLinecap="round" />
        {/* Ochre ginkgo fan */}
        <path d="M96 124C86 102 92 84 110 78C113 88 117 91 122 80C134 90 132 112 110 124H96Z" fill="#DFB654" />
        <path d="M108 124L112 92" stroke="#FAF2D8" strokeWidth="1.3" strokeLinecap="round" />
        {/* Right dark-sage overlapping leaf */}
        <path d="M248 126C246 94 226 76 196 76C204 102 222 120 248 126Z" fill="#21785B" />
        <path d="M248 126C232 106 216 90 196 76" stroke="#A6DFC7" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Vertical layered cut-paper diorama crafted for the bottom of the pale ink-green sidebar. */
export function SidebarPaperArt({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg width="192" height="156" viewBox="0 0 192 156" fill="none" aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      <defs>
        <filter id={`${id}-s`} x="-12%" y="-12%" width="128%" height="132%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.4" floodColor="#184a39" floodOpacity="0.18" />
        </filter>
      </defs>
      {/* Back warm ochre sun disc */}
      <g filter={`url(#${id}-s)`}>
        <circle cx="142" cy="42" r="24" fill="#ECD28A" />
        <circle cx="142" cy="42" r="18" fill="#F6E2A8" />
      </g>
      {/* Rolling soft sage paper hill */}
      <g filter={`url(#${id}-s)`}>
        <path d="M-4 114C32 76 74 68 120 82C150 91 172 76 196 62V156H-4V114Z" fill="#8CC1A8" fillOpacity="0.58" />
      </g>
      {/* Cut-paper SEU dome silhouette */}
      <g filter={`url(#${id}-s)`}>
        <path d="M72 78C72 61 87 49 106 49C125 49 140 61 140 78H72Z" fill="#FAF6EA" />
        <path d="M106 49V78" stroke="#DFD3B2" strokeWidth="1.2" />
        <circle cx="106" cy="45.5" r="3.2" fill="#DFB859" />
        <rect x="64" y="78" width="84" height="8" rx="2" fill="#EFE7D1" />
        <rect x="70" y="86" width="72" height="48" rx="3" fill="#FDFBF4" />
        <path d="M80 134V102C80 97.5 83.5 94 88 94C92.5 94 96 97.5 96 102V134H80Z" fill="#4E947A" />
        <path d="M100 134V100C100 95 104 91 108.5 91C113 91 117 95 117 100V134H100Z" fill="#3C8067" />
        <path d="M121 134V102C121 97.5 124.5 94 128.5 94C132.5 94 136 97.5 136 102V134H121Z" fill="#4E947A" />
      </g>
      {/* Foreground layered ginkgo & sage botanical leaves */}
      <g filter={`url(#${id}-s)`}>
        <path d="M12 150C16 112 36 88 72 82C66 116 44 140 12 150Z" fill="#63AA8E" />
        <path d="M12 150C32 122 50 102 72 82" stroke="#DDF2E8" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M46 152C38 130 44 114 60 108C63 117 67 119 72 110C82 120 79 140 58 152H46Z" fill="#E6C56F" />
        <path d="M190 152C188 120 170 100 142 100C148 126 164 144 190 152Z" fill="#549B7F" />
      </g>
    </svg>
  );
}

/** Bold cut-paper empty state illustration: layered ink-green & cream open chronicle + ochre ginkgo leaf. */
export function EmptyPaperArt({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg width="112" height="86" viewBox="0 0 112 86" fill="none" aria-hidden="true" className={`shrink-0 select-none ${className}`}>
      <defs>
        <filter id={`${id}-s`} x="-10%" y="-10%" width="125%" height="135%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.6" floodColor="#0c3629" floodOpacity="0.16" />
        </filter>
      </defs>
      {/* Back ink-green oval plate */}
      <ellipse cx="56" cy="46" rx="44" ry="30" fill="#0E5240" fillOpacity="0.11" />
      {/* Warm ochre paper fan behind book */}
      <g filter={`url(#${id}-s)`}>
        <circle cx="78" cy="24" r="14" fill="#E6C36B" />
        <path d="M20 28C32 23 45 24 56 30V70C45 65 32 64 20 68V28Z" fill="#FBF7EC" stroke="#D8CEB6" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M92 28C80 23 67 24 56 30V70C67 65 80 64 92 68V28Z" fill="#EFE9D8" stroke="#D8CEB6" strokeWidth="1.2" strokeLinejoin="round" />
      </g>
      {/* Pale celadon ribbon bookmark */}
      <path d="M68 25V53L73.5 48.5L79 53V24.5" fill="#4D957A" />
      {/* Cut-paper green leaf on left page */}
      <path d="M30 50C33 39 41 34 49 34C47 43 40 49 30 50Z" fill="#6BB296" />
      <path d="M27 58H46" stroke="#B7AD95" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
