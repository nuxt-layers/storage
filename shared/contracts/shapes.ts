// ADR-0012 shared shapes, copied verbatim into every capability's contract.

export type Assurance = string

export interface Caller {
  tenantId: string
  subjectId: string | null
  assurance: Assurance
}

export interface Decision {
  allowed: boolean
  reason: string
}

export type ResolveCaller<E = unknown> = (event: E) => Promise<Caller> | Caller

export interface Task {
  name: string
  every: string
  run: () => Promise<void>
}

/**
 * ADR-0012's `now()`. Either a Date or an ISO 8601 UTC instant string, such as
 * the clock layer's port returns (`2026-11-05T14:30:00.000Z`).
 */
export type Clock = () => Date | string
