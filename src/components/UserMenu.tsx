import { useAuth } from '../state/authStore';
import { useResource } from '../hooks/useResource';
import type { AuthUser } from '../api/authSession';
import ProfileMenu from './ProfileMenu';

export const UserMenu = () => {
    const auth = useAuth();
    const identity = useResource<AuthUser>('/auth/me');
    if (!auth.user) return null;
    const user = identity.data?.id === auth.user.id ? identity.data : auth.user;
    // A fresh menu per account prevents old photos and pending uploads crossing accounts.
    return <ProfileMenu key={auth.user.id} user={user} logout={auth.logout} identityError={Boolean(identity.error)} />;
};
