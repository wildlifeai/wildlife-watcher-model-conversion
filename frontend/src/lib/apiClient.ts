import { supabase } from '../config/supabase'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export class ApiError extends Error {
  code: string
  retryable: boolean

  constructor(
    code: string,
    message: string,
    retryable: boolean = false
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
  }
}

async function request(path: string, options: RequestInit = {}) {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  let body
  try {
    body = await response.json()
  } catch {
    // Some responses (like ZIP downloads) might not be JSON
    return response.blob()
  }

  if (!response.ok) {
    // Try ApiResponse envelope format first, then FastAPI HTTPException format
    const error = body?.error || { code: 'UNKNOWN', message: 'Request failed' }
    const detail = body?.detail
    let message = error.message
    if (detail) {
      message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ') : JSON.stringify(detail)
    }
    throw new ApiError(error.code || `HTTP_${response.status}`, message, error.retryable)
  }

  // Honour the {data, error, meta} envelope: handlers that return an error
  // envelope with HTTP 200 (e.g. FEATURE_DISABLED, NOT_IMPLEMENTED, NOT_FOUND)
  // must still surface as a thrown ApiError, not a silent "success".
  if (body && typeof body === 'object' && body.error) {
    throw new ApiError(body.error.code || 'ERROR', body.error.message || 'Request failed', body.error.retryable)
  }

  return body
}

export const apiClient = {
  get: (path: string) => request(path),
  post: (path: string, data?: any) => 
    request(path, { method: 'POST', body: JSON.stringify(data) }),
  upload: (path: string, formData: FormData) =>
    request(path, { method: 'POST', body: formData }),
}
