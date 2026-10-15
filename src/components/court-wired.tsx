/**
 * The routes import «المحكمة» from here. The session board, the role guide, the stand order and the
 * generated-case review now live in court.tsx itself (on every screen, run by the server), so this
 * file only passes them through.
 */
export { CourtHostPanel, CourtPlayerPanel, CourtTv, useCourtLive } from "@/components/court";
