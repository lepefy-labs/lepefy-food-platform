'use client';

import { useState } from 'react';
import { IconBan } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import OrderClosureDialog, { type OrderClosureDialogProps } from './OrderClosureDialog';

/** Secondary « Clôturer ou annuler… » action of the order header, with its dialog. */
export default function OrderClosureLauncher(props: Omit<OrderClosureDialogProps, 'open' | 'onClose'>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <IconBan size={16} aria-hidden="true" className="text-tone-danger-fg" /> Clôturer ou annuler…
      </Button>
      <OrderClosureDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
