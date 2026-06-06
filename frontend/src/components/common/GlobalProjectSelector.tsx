import { useState, useRef, useEffect } from 'react'
import { useProjectSelection } from '../../hooks/useProjectSelection'
import { Folder, ChevronDown, CheckSquare, Square } from 'lucide-react'

export function GlobalProjectSelector() {
  const { projects, selectedProjectIds, toggleProject, selectAll, clearAll, isLoading } = useProjectSelection()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (isLoading || projects.length === 0) return null

  const getButtonLabel = () => {
    if (selectedProjectIds.length === 0) return 'All Projects'
    if (selectedProjectIds.length === projects.length) return 'All Projects'
    if (selectedProjectIds.length === 1) {
      return projects.find(p => p.id === selectedProjectIds[0])?.name || '1 Project'
    }
    return `${selectedProjectIds.length} Projects`
  }

  return (
    <div className="relative" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.375rem 0.75rem',
          fontSize: '0.875rem',
          backgroundColor: 'var(--surface, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--text-color)',
          cursor: 'pointer'
        }}
      >
        <Folder size={16} style={{ opacity: 0.7 }} />
        <span style={{ maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {getButtonLabel()}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.5 }} />
      </button>

      {isOpen && (
        <div 
          className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border border-gray-200 z-50"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.5rem',
            width: '250px',
            backgroundColor: 'var(--bg-color, #ffffff)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            zIndex: 50,
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={selectAll}
              style={{ fontSize: '0.75rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              style={{ fontSize: '0.75rem', opacity: 0.6, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {projects.map(project => {
              const isSelected = selectedProjectIds.includes(project.id)
              return (
                <div
                  key={project.id}
                  onClick={() => toggleProject(project.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'rgba(var(--primary-rgb, 59, 130, 246), 0.05)' : 'transparent',
                    fontSize: '0.875rem'
                  }}
                  className="hover:bg-gray-50 transition-colors"
                >
                  {isSelected ? (
                    <CheckSquare size={16} color="var(--primary)" />
                  ) : (
                    <Square size={16} style={{ opacity: 0.3 }} />
                  )}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {project.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
