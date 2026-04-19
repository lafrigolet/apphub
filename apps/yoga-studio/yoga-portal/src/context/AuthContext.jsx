import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { auth as authApi } from '../lib/api.js'

const AuthContext = createContext(null)

function parseJwt(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('yoga_token')
    if (token) {
      const payload = parseJwt(token)
      if (payload && payload.exp > Date.now() / 1000) {
        setUser({ userId: payload.sub, role: payload.role, email: payload.email })
      } else {
        localStorage.removeItem('yoga_token')
        localStorage.removeItem('yoga_refresh')
        localStorage.removeItem('yoga_user_id')
      }
    }
    setLoading(false)
  }, [])

  const login = useCallback(async ({ email, password }) => {
    const data = await authApi.login({ email, password })
    localStorage.setItem('yoga_token', data.accessToken)
    localStorage.setItem('yoga_refresh', data.refreshToken)
    localStorage.setItem('yoga_user_id', data.user.id)
    setUser({ userId: data.user.id, role: data.user.role, email: data.user.email })
    return data.user
  }, [])

  const register = useCallback(async ({ name, email, password }) => {
    await authApi.register({ email, password })
    return login({ email, password })
  }, [login])

  const logout = useCallback(() => {
    localStorage.removeItem('yoga_token')
    localStorage.removeItem('yoga_refresh')
    localStorage.removeItem('yoga_user_id')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
