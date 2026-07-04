import AuthForm from '../components/Auth/AuthForm'
import { useSeo } from '../lib/seo'

export default function SignUpPage() {
  useSeo({ title: 'Create account — ESCAPE Suite', canonicalPath: '/sign-up', noindex: true })
  return <AuthForm mode="sign-up" />
}
