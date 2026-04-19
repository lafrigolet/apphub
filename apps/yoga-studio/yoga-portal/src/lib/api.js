const BASE = import.meta.env.VITE_YOGA_API_URL ?? '/api/yoga'

function getToken() {
  return localStorage.getItem('yoga_token')
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw Object.assign(new Error(err.error?.message ?? 'Request failed'), { status: res.status, code: err.error?.code })
  }

  if (res.status === 204) return null
  const json = await res.json()
  return json.data
}

// Auth
export const auth = {
  register: (body) => request('/auth/register', { method: 'POST', body, auth: false }),
  login: (body) => request('/auth/login', { method: 'POST', body, auth: false }),
  refresh: (body) => request('/auth/refresh', { method: 'POST', body, auth: false }),
  forgotPassword: (body) => request('/auth/forgot-password', { method: 'POST', body, auth: false }),
}

// Users
export const users = {
  me: () => request('/users/me'),
  updateMe: (body) => request('/users/me', { method: 'PUT', body }),
  history: (id) => request(`/users/${id}/history`),
  list: (params = {}) => request(`/users?${new URLSearchParams(params)}`),
}

// Classes
export const classes = {
  list: (params = {}) => request(`/classes/?${new URLSearchParams(params)}`, { auth: false }),
  availability: (id) => request(`/classes/${id}/availability`),
  create: (body) => request('/classes/', { method: 'POST', body }),
  update: (id, body) => request(`/classes/${id}`, { method: 'PUT', body }),
  remove: (id) => request(`/classes/${id}`, { method: 'DELETE' }),
  instructorAgenda: () => request('/classes/instructor/agenda'),
}

// Bookings
export const bookings = {
  list: () => request('/bookings/'),
  create: (body) => request('/bookings/', { method: 'POST', body }),
  cancel: (id, body) => request(`/bookings/${id}`, { method: 'DELETE', body }),
  attend: (id) => request(`/bookings/${id}/attend`, { method: 'POST' }),
  waitlist: (sessionId) => request(`/bookings/waitlist/${sessionId}`),
}

// Bonuses
export const bonuses = {
  me: () => request('/bonuses/me'),
  createType: (body) => request('/bonuses/types', { method: 'POST', body }),
  assign: (body) => request('/bonuses/assign', { method: 'POST', body }),
  adjust: (id, body) => request(`/bonuses/${id}/adjust`, { method: 'PUT', body }),
}

// Payments
export const payments = {
  checkout: (body) => request('/payments/checkout', { method: 'POST', body }),
  list: () => request('/payments/'),
}

// Reports
export const reports = {
  dashboard: () => request('/reports/dashboard'),
  attendance: (params = {}) => request(`/reports/attendance?${new URLSearchParams(params)}`),
  exportAttendance: () => request('/reports/attendance/export', { method: 'POST' }),
}

// Ratings
export const ratings = {
  create: (body) => request('/ratings/', { method: 'POST', body }),
  instructor: (id) => request(`/ratings/instructor/${id}`),
}
