import { createContext, useContext } from 'react'

export interface AuthState {
  isAuthorized: boolean
  isTrial: boolean
  isLoading: boolean
  error: string | null
  customerName?: string
}

export const AuthContext = createContext<AuthState>({
  isAuthorized: false,
  isTrial: false,
  isLoading: true,
  error: null,
})

export const useAuth = () => useContext(AuthContext)
