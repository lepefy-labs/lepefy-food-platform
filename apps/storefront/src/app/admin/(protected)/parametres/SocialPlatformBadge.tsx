import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTiktok,
  IconBrandX,
  IconBrandYoutube,
  type Icon,
} from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type SocialPlatform } from '@lepefy/types';
import { cn } from '@/lib/utils/cn';

const ICONS: Record<SocialPlatform, Icon> = {
  instagram: IconBrandInstagram,
  facebook: IconBrandFacebook,
  tiktok: IconBrandTiktok,
  youtube: IconBrandYoutube,
  linkedin: IconBrandLinkedin,
  x: IconBrandX,
};

/** Platform logo on its brand colour, as on the card and the shop footer. */
export function SocialPlatformBadge({ platform, size = 'md', className }: { platform: SocialPlatform; size?: 'sm' | 'md'; className?: string }) {
  const Glyph = ICONS[platform];
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center text-white', size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl', className)}
      style={{ background: SOCIAL_PLATFORM_REGISTRY[platform].badgeBackground }}
    >
      <Glyph size={size === 'sm' ? 16 : 20} stroke={1.7} />
    </span>
  );
}
