import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { logout } from './login/actions'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return (
    <main className="p-8">
      <p>Signed in as {user.name}</p>
      <form action={logout}>
        <Button type="submit" variant="link">Sign out</Button>
      </form>
    </main>
  )
}
