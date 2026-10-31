import type { ReactNode, SVGProps } from 'react';

/** ParaWerk's own line icon set: 24 px grid, 1.7 px strokes, round joins. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const NewIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Icon>
);

export const OpenIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
    <path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 11H7.4a2 2 0 0 0-1.9 1.4L3 19" />
  </Icon>
);

export const SaveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v5h8V3M7 21v-7h10v7" />
  </Icon>
);

export const BoxIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="M4 7.4 12 12l8-4.6M12 12v9.2" />
  </Icon>
);

export const CylinderIcon = (p: P) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
  </Icon>
);

export const FilletIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V11a7 7 0 0 1 7-7h9" />
    <path d="M4 20h16V4" strokeDasharray="2 2.6" opacity="0.55" />
    <path d="M7.5 9.5 4.8 6.8M9.8 7.4 8.6 4" opacity="0.9" />
  </Icon>
);

export const ChamferIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10l6-6h10" />
    <path d="M4 20h16V4" strokeDasharray="2 2.6" opacity="0.55" />
    <path d="M10 4 4 10" strokeWidth={2.4} />
  </Icon>
);

export const ExportStepIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 3.2 16 6.6v6.9l-6 3.4-6-3.4V6.6z" />
    <path d="M4 6.6 10 10l6-3.4M10 10v6.9" />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

/** A flat outline (2D drawing) with an arrow out of it. */
export const ExportDxfIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 5h11v9H3z" />
    <path d="M6 11.5a2 2 0 1 0 0-.1M10 8h2" strokeWidth={1.3} />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

/** A flat outline (2D drawing) with an arrow into it. */
export const ImportDxfIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 5h11v9H10z" />
    <path d="M14 11.5a2 2 0 1 0 0-.1M17.5 8h1.5" strokeWidth={1.3} />
    <path d="M3 19h7m-2.5-2.5L10 19l-2.5 2.5" />
  </Icon>
);

export const ExportStlIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 17 9 5l6 12zM9 5v12M6 11h6" />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

/** Import a STEP file: an arrow going into a block. */
export const ImportStepIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 9.5 15 6.5l6 3v7l-6 3-6-3" />
    <path d="M9 9.5l6 3 6-3M15 12.5v7" />
    <path d="M2.5 13.5h8m-2.5-2.5 2.5 2.5-2.5 2.5" />
  </Icon>
);

/** 3MF export: a printed part on its build plate, with the export arrow. */
export const ExportThreeMfIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 16.5h12M5 16.5v-5.5l3-3h3l2 2v6.5" />
    <path d="M8 13.5h3" />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = (p: P) => (
  <Icon {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Icon>
);

export const InfoIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </Icon>
);

export const ZoomFitIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </Icon>
);

export const ViewsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="M4 7.4 12 12l8-4.6-8-4.6z" fill="currentColor" fillOpacity="0.28" />
    <path d="M12 12v9.2" />
  </Icon>
);

export const ProjectionIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 8.5 9 6v12l-6-2.5z" />
    <path d="M9 6l12-3v18L9 18" />
  </Icon>
);

/** A line with a relation badge next to it. */
export const RelationsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 20.5 12 12" />
    <circle cx="3.5" cy="20.5" r="0.6" fill="currentColor" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    <rect x="13" y="3" width="8" height="8" rx="2" />
    <path d="M15.4 6h3.2M15.4 8.2h3.2" />
  </Icon>
);

export const EditIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const EyeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10.6 5.6A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.7 16.7 0 0 1-2.6 3.4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2" />
    <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);

export const MoreIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 6v.01M12 12v.01M12 18v.01" strokeWidth={2.6} />
  </Icon>
);

/** Material: a block with the grain of its stock on the front. */
export const MaterialIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4z" />
    <path d="M4 7.5l8 4 8-4M12 11.5v9" />
    <path d="M6.5 12.2 9.5 9.7M6.5 15.6l3.5-3M8.2 18.1l1.8-1.6" />
  </Icon>
);

/** Mass properties: a weight with its center of mass. */
export const MassPropertiesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9.5 8.5a2.5 2.5 0 1 1 5 0" />
    <path d="M7 8.5h10l2.5 11.5h-15z" />
    <circle cx="12" cy="14.5" r="1.6" />
  </Icon>
);

/** Section view: a block cut open, its cut face hatched. */
export const SectionIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9.5 12 5.5l8 4v6l-8 4-8-4z" />
    <path d="M4 9.5l8 4 8-4M12 13.5v6" />
    <path d="M6.5 13.6l2.5-1.3M6.5 16.6l4-2M9.5 17.9l1.5-.8" />
    <path d="M2.5 4.5h19" strokeDasharray="2 2.2" />
  </Icon>
);

/** Measure: a ruler laid at an angle, with its ticks. */
export const MeasureIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 15.5 15.5 3.5l5 5-12 12z" />
    <path d="M7 12l2 2M9.5 9.5l1.5 1.5M12 7l2 2M14.5 4.5l1.5 1.5" />
  </Icon>
);

/** Rolls the part forward: an arrow down to the end of the tree. */
export const RollForwardIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
  </Icon>
);

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const OriginIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 19 5 5M5 19h14M5 19l8-8" />
    <circle cx="5" cy="19" r="1.4" fill="currentColor" />
  </Icon>
);

export const SketchIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10a6 6 0 0 1 6-6h5M4 20h6" />
    <path d="m13.5 19.5.6-3 6-6a1.5 1.5 0 0 1 2.1 2.1l-6 6z" />
    <circle cx="4" cy="20" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

/** Leaves sketch mode and keeps the sketch: the sketch corner with a check mark. */
export const ExitSketchIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10a6 6 0 0 1 6-6h5M4 20h6" />
    <path d="m13 16 3 3 6-6.5" />
    <circle cx="4" cy="20" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

const dot = (cx: number, cy: number, r = 1.5) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

export const LineIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 19 19 5" />
    {dot(5, 19)}
    {dot(19, 5)}
  </Icon>
);

/** Long-short dashes, as centerlines are drawn on technical drawings. */
export const CenterlineIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20 20 4" strokeDasharray="5 2.5 1.2 2.5" />
  </Icon>
);

export const CornerRectangleIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" />
    {dot(4, 18, 1.8)}
    {dot(20, 6, 1.8)}
  </Icon>
);

export const ThreePointRectangleIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 14 13 5l5.7 5.7-9 9z" />
    {dot(4, 14, 1.8)}
    {dot(13, 5, 1.8)}
    {dot(18.7, 10.7, 1.8)}
  </Icon>
);

export const ParallelogramIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 18 8 6h13l-5 12z" />
    {dot(3, 18, 1.8)}
    {dot(8, 6, 1.8)}
    {dot(21, 6, 1.8)}
  </Icon>
);

export const CenterRectangleIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" />
    <path d="M4 18 20 6" strokeDasharray="2 2" strokeWidth={1.2} />
    {dot(12, 12, 1.8)}
    {dot(20, 6, 1.8)}
  </Icon>
);

export const CircleIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12h8" strokeDasharray="2 2" strokeWidth={1.2} />
    {dot(12, 12)}
  </Icon>
);

export const CenterArcIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 16a8 8 0 0 1 16 0" />
    <path d="M4 16h16" strokeDasharray="2 2" strokeWidth={1.2} />
    {dot(12, 16)}
  </Icon>
);

export const ThreePointArcIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 18a9.2 9.2 0 0 1 16 0" />
    {dot(4, 18, 1.8)}
    {dot(12, 9.3, 1.8)}
    {dot(20, 18, 1.8)}
  </Icon>
);

/** "fx": named values and equations. */
export const VariablesIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M11 8.5c-1.6-.6-2.8 0-3 1.6L7.2 16c-.2 1.5-1.3 2.1-2.4 1.6M5.8 11.5h4" />
    <path d="m13 11 5 5.5M18 11l-5 5.5" />
  </Icon>
);

/** A model edge projected down onto the sketch plane. */
export const ConvertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 19.5 7.5 15h13.5L16.5 19.5z" />
    <path d="M7 4.5h10" strokeWidth={2.2} />
    <path d="M12 7v6.5M9.5 11l2.5 2.5 2.5-2.5" />
  </Icon>
);

export const SplineIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 18c2.5-7 6-8.5 9-6s6.5 1 9-6" />
    {dot(3, 18, 1.8)}
    {dot(12, 12, 1.8)}
    {dot(21, 6, 1.8)}
  </Icon>
);

export const EllipseIcon = (p: P) => (
  <Icon {...p}>
    <ellipse cx="12" cy="12" rx="9.5" ry="6" />
    {dot(12, 12, 1.6)}
    {dot(21.5, 12, 1.8)}
  </Icon>
);

export const ThreePointCircleIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    {dot(4.4, 9.5, 1.8)}
    {dot(17.5, 6.2, 1.8)}
    {dot(14.5, 19.6, 1.8)}
  </Icon>
);

/** A line continued by an arc that leaves it tangentially. */
export const TangentArcIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 19h9a7 7 0 0 0 7-7V5" />
    {dot(12, 19, 1.8)}
    {dot(19, 5, 1.8)}
  </Icon>
);

export const SlotIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z" />
    <path d="M8 12h8" strokeDasharray="2 2" strokeWidth={1.2} />
    {dot(8, 12, 1.4)}
    {dot(16, 12, 1.4)}
  </Icon>
);

export const PolygonIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5z" />
    {dot(12, 12, 1.4)}
  </Icon>
);

export const PointIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5v4.5M12 16v4.5M3.5 12H8M16 12h4.5" />
    {dot(12, 12, 2.4)}
  </Icon>
);

/** A corner rounded off; the sharp corner it replaces is dashed. */
export const SketchFilletIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20v-7a8 8 0 0 1 8-8h8" />
    <path d="M4 13V5h8" strokeDasharray="2 2" strokeWidth={1.2} />
  </Icon>
);

export const SketchChamferIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20v-9l6-6h10" />
    <path d="M4 11V5h6" strokeDasharray="2 2" strokeWidth={1.2} />
  </Icon>
);

/** Trim: a crossing with the piece to remove dashed, and scissors-like cut marks. */
export const TrimIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 12h7" />
    <path d="M10 12h11" strokeDasharray="2 2.2" strokeWidth={1.3} />
    <path d="M10 4v16" />
    <path d="m15 8 4 8M19 8l-4 8" strokeWidth={1.4} />
  </Icon>
);

/** Extend: a line growing up to a boundary. */
export const ExtendIcon = (p: P) => (
  <Icon {...p}>
    <path d="M20 4v16" />
    <path d="M3 12h8" />
    <path d="M11 12h7" strokeDasharray="2 2" strokeWidth={1.3} />
    <path d="m15 9 3 3-3 3" strokeWidth={1.4} />
  </Icon>
);

/** Construction geometry is drawn dashed. */
export const ConstructionIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" strokeDasharray="3 2.4" />
    <path d="M4 18 20 6" strokeDasharray="3 2.4" />
  </Icon>
);

/** A dimension: two extension lines, the dimension line with arrows and the value above. */
export const DimensionIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20v-9M20 20v-9M4 15h16" />
    <path d="m7 12.6-3 2.4 3 2.4M17 12.6l3 2.4-3 2.4" strokeWidth={1.4} />
    <path d="M9.5 5.5h5M12 3v5" strokeWidth={1.4} />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

/** A reference plane seen at an angle. */
export const PlaneIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 17.5 7 6.5h14.5L17 17.5z" />
  </Icon>
);

/** Extrude: a flat profile, the top it grows to (dashed) and an arrow pointing up. */
export const ExtrudeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 19.5 7 16h14.5L17 19.5z" />
    <path d="M2.5 12.5 7 9h14.5L17 12.5zM2.5 19.5v-7M17 19.5v-7M21.5 16V9" strokeDasharray="2 2.4" opacity="0.55" />
    <path d="M12 14.5V3.5M9 6.5l3-3 3 3" />
  </Icon>
);

/** Revolve: a profile beside a dashed axis and an arrow turning around it. */
export const RevolveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.5v19" strokeDasharray="2.2 2" opacity="0.55" />
    <path d="M13.5 6h4v10h-4" />
    <path d="M7.5 9.2c-2.3.6-3.8 1.6-3.8 2.8 0 2 4.1 3.6 9.3 3.6" />
    <path d="m11.2 13.4 2.1 2.2-2.1 2.2" />
  </Icon>
);

/** Reference plane: a plane and a dashed copy of it lifted above, with the distance between them. */
export const ReferencePlaneIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 20.5 6 15h15.5L18 20.5z" />
    <path d="M2.5 10.5 6 5h15.5L18 10.5z" strokeDasharray="2.2 2" />
    <path d="M10.5 17.5v-5M8.8 14l1.7-1.7 1.7 1.7" />
  </Icon>
);

/** Reference axis: a dash-dot line through a ring turning around it. */
export const ReferenceAxisIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2v4.5M12 8.5v3M12 13.5v3M12 18.5V22" />
    <ellipse cx="12" cy="12" rx="7.5" ry="3" />
  </Icon>
);

/** Reference point: a point in a ring with marks to its four sides. */
export const ReferencePointIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="5.5" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    {dot(12, 12, 1.8)}
  </Icon>
);

/** Rib: an angle with a triangular wall in its corner. */
export const RibIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 3.5v17h17" />
    <path d="M3.5 8.5 15.5 20.5" />
    <path d="M6 11.5V18h6.5" opacity="0.55" />
  </Icon>
);

/** Thread: a bolt with slanted thread lines. */
export const ThreadIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7.5 3.5h9v17h-9z" />
    <path d="M7.5 7.5l9-2M7.5 11.5l9-2M7.5 15.5l9-2M7.5 19.5l9-2" />
  </Icon>
);

/** Helix: a coil seen from the side, its far half lighter. */
export const HelixIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 3.5q7 4.5 14 2.25M5 8q7 4.5 14 2.25M5 12.5q7 4.5 14 2.25M5 17q7 4.5 14 2.25" />
    <path d="M19 5.75Q12 4 5 8M19 10.25Q12 8.5 5 12.5M19 14.75Q12 13 5 17" opacity="0.45" />
  </Icon>
);

/** Projected curve: a curve drawn above a curved surface and the same curve lying on it. */
export const ProjectedCurveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 18.5c3-3.5 15-3.5 18 0" opacity="0.55" />
    <path d="M5 6.5c2.5-2 5 2 7 0s4.5-2 7 0" strokeDasharray="2.2 2" />
    <path d="M5 16.3c2.5-1.6 5 .9 7-.3s4.5-1.1 7 .3" />
    <path d="M8.5 8.5v5M15.5 8.5v5M7 12l1.5 1.5L10 12M14 12l1.5 1.5L17 12" opacity="0.7" />
  </Icon>
);

/** Composite curve: a straight piece, an arc and another straight piece joined at dots. */
export const CompositeCurveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 19.5 9 13.5a5 5 0 0 1 7-7l5-3" />
    {dot(9, 13.5, 1.6)}
    {dot(16, 6.5, 1.6)}
  </Icon>
);

/** Combine bodies: two overlapping squares joined into one outline. */
export const CombineIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 3.5h11v6h6v11h-11v-6h-6z" />
    <path d="M9.5 9.5h5v5h-5z" strokeDasharray="2 1.6" opacity="0.6" />
  </Icon>
);

/** Split: a block in two pieces, the plane between them dashed. */
export const SplitIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 7.5h6.5v12H3.5zM14 7.5h6.5v12H14z" />
    <path d="M12 3.5v17" strokeDasharray="2 1.6" opacity="0.6" />
  </Icon>
);

/** Delete body: a block with a minus sign beside it. */
export const DeleteBodyIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 10.5 9.5 7l6.5 3.5v7L9.5 21 3 17.5z" />
    <path d="M3 10.5l6.5 3.5 6.5-3.5M9.5 14v7" opacity="0.6" />
    <path d="M16.5 5h5" />
  </Icon>
);

/** Solid bodies of a part: two blocks side by side. */
export const BodiesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 9.5 7 7l4.5 2.5v6L7 18l-4.5-2.5z" />
    <path d="M12.5 8.5 17 6l4.5 2.5v6L17 17l-4.5-2.5z" />
  </Icon>
);

/** Offset surface: a face and a dashed copy of it lifted along arrows. */
export const OffsetSurfaceIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 17.5 9 14l12 3.5-6 3.5z" />
    <path d="M3 9.5 9 6l12 3.5-6 3.5z" strokeDasharray="2.2 2" />
    <path d="M12 16v-5M10.5 12.5 12 11l1.5 1.5" opacity="0.7" />
  </Icon>
);

/** Knit: two surface patches stitched along their common edge. */
export const KnitIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 8.5 11 5v13l-8 3.5zM13 5l8 3.5v13l-8-3.5z" />
    <path d="M10 9h4M10 12.5h4M10 16h4" opacity="0.7" />
  </Icon>
);

/** Thicken: a curved surface over the solid it becomes. */
export const ThickenIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 9c4-4 14-4 18 0" />
    <path d="M3 9v6c4-4 14-4 18 0V9" opacity="0.55" />
    <path d="M12 3v3M10.5 4.5 12 6l1.5-1.5" />
  </Icon>
);

/** Configurations: stacked cards of one part, the front one with lines of values. */
export const ConfigurationsIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="9" width="13" height="11" rx="1.5" />
    <path d="M6.5 6h12a1.5 1.5 0 0 1 1.5 1.5V17M9.5 3h12" />
    <path d="M6.5 13.5h6M6.5 16.5h4" />
  </Icon>
);

/** Move up in a list. */
export const MoveUpIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
  </Icon>
);

/** Sweep: a circle swept along a bent path. */
export const SweepIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20.5V12a7 7 0 0 1 7-7h9.5" strokeDasharray="2.2 2" opacity="0.6" />
    <ellipse cx="4" cy="17" rx="2.5" ry="3.5" />
    <path d="M17.5 2.5 20.5 5l-3 2.5" />
  </Icon>
);

/** Loft: a large outline at the bottom joined to a smaller one above. */
export const LoftIcon = (p: P) => (
  <Icon {...p}>
    <ellipse cx="12" cy="18.5" rx="8.5" ry="2.5" />
    <ellipse cx="12" cy="5.5" rx="4" ry="1.5" />
    <path d="M3.5 18.5 8 5.5M20.5 18.5 16 5.5" />
  </Icon>
);

/** Draft: a block whose sides lean in, over a dashed neutral line, with the pull direction above it. */
export const DraftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5.5 19 8.5 8.5h7l3 10.5" />
    <path d="M2.5 19h19" strokeDasharray="2.2 2" />
    <path d="M12 6.5V2.5M10 4.5l2-2 2 2" />
  </Icon>
);

/** Coordinate system: three arrows from an origin point, up, to the right and towards the viewer. */
export const CoordinateSystemIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 15V4M9 15h12M9 15l-5.5 5.5" />
    <path d="m7 6.5 2-2.5 2 2.5M18.5 13l2.5 2-2.5 2M3.5 17.3v3.2h3.2" />
    {dot(9, 15, 1.6)}
  </Icon>
);

/** Hole: a plate in section with a counterbored hole and its dashed axis. */
export const HoleIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 8.5h5.5v3.5h2v7.5h-7.5zM21.5 8.5H16v3.5h-2v7.5h7.5z" />
    <path d="M12 4.5v17" strokeDasharray="2.2 2" opacity="0.55" />
  </Icon>
);

/** Linear pattern: a solid square and two dashed copies in a row along an arrow. */
export const PatternIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="9" width="5" height="5" rx="0.8" />
    <rect x="9.5" y="9" width="5" height="5" rx="0.8" strokeDasharray="2 1.6" />
    <rect x="16.5" y="9" width="5" height="5" rx="0.8" strokeDasharray="2 1.6" />
    <path d="M3 18.5h17M17.5 16.5l2.5 2-2.5 2" />
  </Icon>
);

/** Circular pattern: a solid dot and dashed copies on a circle around a center mark. */
export const CircularPatternIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="7" opacity="0.45" />
    <circle cx="12" cy="5" r="2.3" />
    <circle cx="18.1" cy="15.5" r="2.3" strokeDasharray="1.8 1.4" />
    <circle cx="5.9" cy="15.5" r="2.3" strokeDasharray="1.8 1.4" />
    <path d="M12 10.5v3M10.5 12h3" />
  </Icon>
);

/** Mirror: a shape, its dashed mirror image and the dash-dot mirror plane between them. */
export const MirrorIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.5v4M12 8.5v2M12 12.5v4M12 18.5v3" />
    <path d="M9.5 6.5 4 9v8.5h5.5z" />
    <path d="M14.5 6.5 20 9v8.5h-5.5z" strokeDasharray="2 1.6" />
  </Icon>
);

/** Shell: a box hollowed out to thin walls, open at the top. */
export const ShellIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 9.5 12 5l9 4.5v8L12 22l-9-4.5z" />
    <path d="M6 10.3 12 7.3l6 3v6l-6 3-6-3z" strokeDasharray="2 1.6" opacity="0.7" />
    <path d="M3 9.5l3 0.8M21 9.5l-3 0.8M12 22v-2.7" opacity="0.7" />
  </Icon>
);

export const FEATURE_ICONS = {
  variables: VariablesIcon,
  sketch: SketchIcon,
  plane: ReferencePlaneIcon,
  axis: ReferenceAxisIcon,
  point: ReferencePointIcon,
  csys: CoordinateSystemIcon,
  extrude: ExtrudeIcon,
  revolve: RevolveIcon,
  hole: HoleIcon,
  pattern: PatternIcon,
  mirror: MirrorIcon,
  box: BoxIcon,
  cylinder: CylinderIcon,
  import: ImportStepIcon,
  fillet: FilletIcon,
  chamfer: ChamferIcon,
  shell: ShellIcon,
  draft: DraftIcon,
  sweep: SweepIcon,
  loft: LoftIcon,
  rib: RibIcon,
  thread: ThreadIcon,
  helix: HelixIcon,
  projectedCurve: ProjectedCurveIcon,
  compositeCurve: CompositeCurveIcon,
  combine: CombineIcon,
  deleteBody: DeleteBodyIcon,
  split: SplitIcon,
  offsetSurface: OffsetSurfaceIcon,
  knit: KnitIcon,
  thicken: ThickenIcon,
} as const;
