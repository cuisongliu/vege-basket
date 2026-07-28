import type { ProjectPackageOperation } from '../types'

export function getProjectPackageOperationTitle(
  operation: Pick<ProjectPackageOperation, 'kind' | 'label' | 'title'>,
  fallback: string,
) {
  const primaryTitle = operation.kind === 'document' ? operation.title : operation.label
  const legacyTitle = operation.kind === 'document' ? operation.label : operation.title

  return primaryTitle.trim() || legacyTitle.trim() || fallback
}
