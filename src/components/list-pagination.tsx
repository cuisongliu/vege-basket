import { Button } from './ui/button'
import './list-pagination.css'

export function ListPagination({ label, page, pageSize, pageSizeOptions = [20, 50], total, disabled = false, onPageChange, onPageSizeChange }: {
  label: string
  page: number
  pageSize: number
  pageSizeOptions?: number[]
  total: number
  disabled?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pageSizeOptions = Array.from(new Set([10, 20, 50, pageSize])).sort((left, right) => left - right)
  return (
    <nav className="list-pagination" aria-label={label}>
      <span className="list-pagination-summary" aria-live="polite">
        {total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)}` : '0'} / {total} 条
      </span>
      <div className="list-pagination-controls">
        {onPageSizeChange ? (
          <select aria-label={`${label}每页条数`} value={pageSize} disabled={disabled} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizeOptions.map((size) => <option key={size} value={size}>{size} 条/页</option>)}
          </select>
        ) : null}
        <Button type="button" variant="ghost" disabled={disabled || page === 0} onClick={() => onPageChange(page - 1)}>上一页</Button>
        <span aria-label={`第 ${page + 1} 页，共 ${pages} 页`}>{page + 1} / {pages}</span>
        <Button type="button" variant="ghost" disabled={disabled || page >= pages - 1} onClick={() => onPageChange(page + 1)}>下一页</Button>
      </div>
    </nav>
  )
}
