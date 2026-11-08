import { useT } from '../i18n'
import { Dialog } from './Dialog'

interface Props {
  title: string
  text: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, text, confirmLabel, destructive, onConfirm, onCancel }: Props): React.JSX.Element {
  const t = useT()
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      onSubmit={onConfirm}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={destructive ? 'btn danger' : 'btn primary'}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{text}</p>
    </Dialog>
  )
}
