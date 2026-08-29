/**
 * Set ikon SVG inline (16px, goresan 1.8, warna mengikuti teks) — pengganti
 * emoji di seluruh UI. Satu gaya, satu berat visual. Semua dekoratif
 * (aria-hidden): makna disampaikan label teks di sebelahnya.
 */

const Icon: React.FC<{
  children: React.ReactNode;
  filled?: boolean;
  className?: string;
}> = ({ children, filled = false, className }) => (
  <svg
    aria-hidden="true"
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke={filled ? "none" : "currentColor"}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...(className ? { className } : {})}
  >
    {children}
  </svg>
);

export const IconUndo: React.FC = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const IconRedo: React.FC = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const IconMic: React.FC = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Icon>
);

export const IconImage: React.FC = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="m21 15-4.5-4.5L6 21" />
  </Icon>
);

export const IconPlay: React.FC = () => (
  <Icon filled>
    <path d="M8 5.5v13l11-6.5Z" />
  </Icon>
);

export const IconExport: React.FC = () => (
  <Icon>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 21h14" />
    <path d="M5 17v4M19 17v4" />
  </Icon>
);

export const IconLock: React.FC = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 1 1 8 0v4" />
  </Icon>
);

export const IconPin: React.FC = () => (
  <Icon>
    <path d="M9 4h6l-.8 6.2 3.3 3.3H6.5l3.3-3.3Z" />
    <path d="M12 13.5V21" />
  </Icon>
);

export const IconTrash: React.FC = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="m6.5 7 .9 13h9.2l.9-13" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
);

export const IconPlus: React.FC = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconSearch: React.FC = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

export const IconChat: React.FC = () => (
  <Icon>
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.9-3.4A8.5 8.5 0 1 1 21 11.5Z" />
  </Icon>
);

export const IconSliders: React.FC = () => (
  <Icon>
    <path d="M4 7h9M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

export const IconDownload: React.FC = () => (
  <Icon>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
);

export const IconSpinner: React.FC = () => (
  <Icon className="spin">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);
