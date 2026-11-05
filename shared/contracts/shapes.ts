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

export type Clock = () => Date
