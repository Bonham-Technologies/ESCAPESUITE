import { SignIn } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import styles from './Auth.module.css'

export default function SignInPage() {
  return (
    <div className={styles.authPage}>
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        afterSignInUrl="/dashboard"
        appearance={{
          baseTheme: dark,
          variables: {
            colorPrimary: '#6366f1',
            colorBackground: '#12121a',
            colorInputBackground: '#1a1a2e',
            colorInputText: '#ffffff',
            colorText: '#ffffff',
            colorTextSecondary: '#a0a0b0',
            colorDanger: '#ef4444',
            borderRadius: '8px',
          },
          elements: {
            rootBox: styles.clerkRoot,
            card: styles.clerkCard,
          },
        }}
      />
    </div>
  )
}
