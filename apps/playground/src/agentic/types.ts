export type AgenticAsyncResult = {
    op: string
    status: 'pending' | 'success' | 'error'
    result?: unknown
    error?: string
}

export type SetAgenticAsyncResult = (result: AgenticAsyncResult) => void
