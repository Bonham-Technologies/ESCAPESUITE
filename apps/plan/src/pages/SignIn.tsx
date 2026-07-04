import AuthForm from '../components/Auth/AuthForm'
import { useSeo } from '../lib/seo'

export default function SignInPage() {
  useSeo({ title: 'Sign in — ESCAPE Suite', canonicalPath: '/sign-in', noindex: true })
  return <AuthForm mode="sign-in" />
}
