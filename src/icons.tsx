// Small inline SVG icons (currentColor)
type P = { size?: number };
const svg = (size: number, children: React.ReactNode, fill = "none") => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={fill === "none" ? "currentColor" : "none"}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const IBack = ({ size = 18 }: P) => svg(size, <path d="M15 18l-6-6 6-6" />);
export const IFwd = ({ size = 18 }: P) => svg(size, <path d="M9 18l6-6-6-6" />);
export const IUp = ({ size = 18 }: P) => svg(size, <path d="M12 19V5M5 12l7-7 7 7" />);
export const IRefresh = ({ size = 18 }: P) => svg(size, <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>);
export const IFull = ({ size = 18 }: P) => svg(size, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IExitFull = ({ size = 18 }: P) => svg(size, <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />);
export const IClose = ({ size = 18 }: P) => svg(size, <path d="M6 6l12 12M18 6L6 18" />);
export const IPlay = ({ size = 18 }: P) => svg(size, <path d="M7 4.5v15l13-7.5z" />, "currentColor");
export const IPause = ({ size = 18 }: P) => svg(size, <><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>, "currentColor");
export const IRew = ({ size = 18 }: P) => svg(size, <><path d="M11 6L4 12l7 6z" /><path d="M20 6l-7 6 7 6z" /></>, "currentColor");
export const IFf = ({ size = 18 }: P) => svg(size, <><path d="M13 6l7 6-7 6z" /><path d="M4 6l7 6-7 6z" /></>, "currentColor");
export const IVol = ({ size = 18 }: P) => svg(size, <><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>);
export const IMute = ({ size = 18 }: P) => svg(size, <><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l5 6M22 9l-5 6" /></>);
export const ISortAsc = ({ size = 18 }: P) => svg(size, <path d="M7 4v16M3 8l4-4 4 4M14 6h7M14 12h5M14 18h3" />);
export const ISortDesc = ({ size = 18 }: P) => svg(size, <path d="M7 4v16M3 16l4 4 4-4M14 6h3M14 12h5M14 18h7" />);
export const IInfo = ({ size = 18 }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>);

export const IFolder = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5l2 2h10A1.5 1.5 0 0 1 22 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5z" fill="#e8b84a" />
    <path d="M2 9h20v9.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5z" fill="#f5cd62" />
  </svg>
);
export const IDrive = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <rect x="2" y="7" width="20" height="10" rx="2" fill="#8a94a3" />
    <rect x="2" y="13" width="20" height="4" rx="1.5" fill="#6b7482" />
    <circle cx="18" cy="15" r="1" fill="#5fd27a" />
  </svg>
);
export const IPc = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <rect x="2" y="4" width="20" height="13" rx="1.5" fill="#4a9bf0" />
    <rect x="4" y="6" width="16" height="9" fill="#9fd0ff" />
    <rect x="8" y="18" width="8" height="2" rx="1" fill="#8a94a3" />
  </svg>
);
export const IFile = ({ size = 18, label = "" }: P & { label?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M5 2h10l5 5v15H5z" fill="#3a404a" stroke="#6b7482" strokeWidth="1" />
    <path d="M15 2v5h5" fill="none" stroke="#6b7482" strokeWidth="1" />
    {label && <text x="12.5" y="17" fontSize="5" textAnchor="middle" fill="#cfd5dd" fontFamily="sans-serif">{label.slice(0, 4).toUpperCase()}</text>}
  </svg>
);
