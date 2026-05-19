import { useState, useCallback, useRef } from 'react';

export default function useConfirm() {
  const [state, setState] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'danger',
    icon: null,
  });
  const resolveRef = useRef(null);

  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger', icon = null } = {}) => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setState({ open: true, title, message, confirmLabel, cancelLabel, variant, icon });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(s => ({ ...s, open: false }));
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setState(s => ({ ...s, open: false }));
    resolveRef.current?.(false);
  }, []);

  return {
    confirm,
    confirmProps: { ...state, onConfirm: handleConfirm, onCancel: handleCancel },
  };
}
