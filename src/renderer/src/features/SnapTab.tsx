import type { Project } from '@shared/types'

export function SnapTab({ project }: { project: Project }): React.JSX.Element {
  return <p className="muted">Snap — {project.name}</p>
}
