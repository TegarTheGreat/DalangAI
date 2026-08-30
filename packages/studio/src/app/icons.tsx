/**
 * Set ikon SVG inline (16px, goresan 1.8, warna mengikuti teks) — pengganti
 * emoji di seluruh UI. Digambar presisi di grid 24 dengan bentuk yang sudah
 * baku di editor/OS (mic, gembok, pin, sparkles) supaya terbaca sekali
 * lihat. Semua dekoratif (aria-hidden): makna disampaikan label teks.
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
    <path d="M12 2.5a3 3 0 0 1 3 3V12a3 3 0 0 1-6 0V5.5a3 3 0 0 1 3-3Z" />
    <path d="M19 10.5V12a7 7 0 0 1-14 0v-1.5" />
    <path d="M12 19v3" />
  </Icon>
);

export const IconImage: React.FC = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </Icon>
);

export const IconPlay: React.FC = () => (
  <Icon filled>
    <path d="M8 5.5v13l11-6.5Z" />
  </Icon>
);

export const IconPause: React.FC = () => (
  <Icon filled>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Icon>
);

/** Panah keluar dari baki — konvensi "Export" di editor video. */
export const IconExport: React.FC = () => (
  <Icon>
    <path d="M12 15V4" />
    <path d="m6.5 9.5 5.5-5.5 5.5 5.5" />
    <path d="M4 15v3a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-3" />
  </Icon>
);

export const IconDownload: React.FC = () => (
  <Icon>
    <path d="M12 3v11" />
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    <path d="M4 17v1a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-1" />
  </Icon>
);

export const IconLock: React.FC = () => (
  <Icon>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Icon>
);

/** Paku payung (pushpin): kepala, bahu, jarum. */
export const IconPin: React.FC = () => (
  <Icon>
    <path d="M9 3h6" />
    <path d="M10 3v5.5l-3.4 2.9a1 1 0 0 0 .65 1.76h9.5a1 1 0 0 0 .65-1.76L14 8.5V3" />
    <path d="M12 13.2V21" />
  </Icon>
);

export const IconTrash: React.FC = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="m6 7 1 13.5h10L18 7" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Icon>
);

export const IconPlus: React.FC = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Belah klip di playhead: garis potong + dua bagian menjauh. */
export const IconSplit: React.FC = () => (
  <Icon>
    <path d="M12 4v16" strokeDasharray="2.6 2.4" />
    <path d="M8.5 8.5 5 12l3.5 3.5" />
    <path d="M15.5 8.5 19 12l-3.5 3.5" />
  </Icon>
);

export const IconX: React.FC = () => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
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
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
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

/** Bintang empat titik + kilau kecil — bahasa visual "AI/generatif". */
export const IconSparkles: React.FC = () => (
  <Icon>
    <path
      d="M11 3.5 12.9 9l5.6 1.9-5.6 1.9L11 18.3l-1.9-5.5-5.6-1.9L9.1 9Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M18.5 14.5v5M16 17h5" />
  </Icon>
);

/** Pesawat kertas — kirim pesan. */
export const IconSend: React.FC = () => (
  <Icon>
    <path d="m21.5 2.5-7 19-3.6-8.4-8.4-3.6Z" />
    <path d="M21.5 2.5 10.9 13.1" />
  </Icon>
);

export const IconCheck: React.FC = () => (
  <Icon>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

/** Palet pelukis — gaya/identitas visual proyek. */
export const IconPalette: React.FC = () => (
  <Icon>
    <path d="M12 3a9 9 0 1 0 .05 18h1.6a2.1 2.1 0 0 0 1.5-3.58l-.5-.5A1.9 1.9 0 0 1 16 13.7h2.8A2.2 2.2 0 0 0 21 11.5 8.7 8.7 0 0 0 12 3Z" />
    <circle cx="7.6" cy="10.4" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="10.8" cy="7.2" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.2" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);

/** Papan jepit bercentang — catatan sutradara atas draft. */
export const IconClipboard: React.FC = () => (
  <Icon>
    <path d="M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" />
    <rect x="9" y="3" width="6" height="3" rx="1" />
    <path d="m9.5 13 1.8 1.8L15 11" />
  </Icon>
);

export const IconSpinner: React.FC = () => (
  <Icon className="spin">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);
