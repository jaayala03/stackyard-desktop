import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  onSubmit?: () => void
  wide?: boolean
}

/** Modal built on the native <dialog>: focus trap, Esc to close and inert background for free. */
export function Dialog({ title, onClose, children, footer, onSubmit, wide }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    onSubmit?.()
  }

  return (
    <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} onClose={onClose} aria-labelledby="dialog-title">
      <form onSubmit={submit}>
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">{footer}</footer>
      </form>
    </dialog>
  )
}
