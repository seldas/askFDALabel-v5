import React, { useState, useEffect } from 'react';

interface ExportWorkspaceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: { taskId?: number; taskName?: string; tags?: string }) => void;
}

export const ExportWorkspaceModal: React.FC<ExportWorkspaceModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [existingTasks, setExistingTasks] = useState<Array<{ id: number; title: string }>>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<number | 'new'>('new');
    const [taskName, setTaskName] = useState('');
    const [tagsInput, setTagsInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            fetch('/api/dashboard/projects')
                .then(res => res.json())
                .then(data => {
                    if (data && data.projects) {
                        setExistingTasks(data.projects);
                    }
                })
                .catch(err => console.error("Failed to load tasks", err))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        let chosenTaskName = '';
        let chosenTaskId: number | undefined = undefined;

        if (selectedTaskId === 'new') {
            if (!taskName.trim()) return;
            chosenTaskName = taskName.trim();
        } else {
            chosenTaskId = selectedTaskId;
            const t = existingTasks.find(x => x.id === selectedTaskId);
            chosenTaskName = t ? t.title : '';
        }

        onConfirm({
            taskId: chosenTaskId,
            taskName: chosenTaskName,
            tags: tagsInput.trim()
        });

        // Reset states
        setTaskName('');
        setTagsInput('');
        setSelectedTaskId('new');
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
        }}>
            <div style={{
                backgroundColor: '#fff',
                borderRadius: '16px',
                padding: '32px',
                width: '100%',
                maxWidth: '460px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                animation: 'fadeIn 0.2s ease-out'
            }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '8px', marginTop: 0 }}>
                    Export to Dashboard
                </h2>
                <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '24px' }}>
                    Select a task to export the labeling list to, or create a new one. You can also assign tags.
                </p>

                <form onSubmit={handleSubmit}>
                    {/* Task Selection Dropdown */}
                    <div style={{ marginBottom: '18px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Destination Task
                        </label>
                        <select
                            value={selectedTaskId}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSelectedTaskId(val === 'new' ? 'new' : parseInt(val));
                            }}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '2px solid #e2e8f0',
                                fontSize: '0.95rem',
                                color: '#1e293b',
                                backgroundColor: 'white',
                                outline: 'none',
                                cursor: 'pointer',
                                boxSizing: 'border-box'
                            }}
                        >
                            <option value="new">+ Create a new task...</option>
                            {existingTasks.map(task => (
                                <option key={task.id} value={task.id}>
                                    {task.title === 'Favorite' ? '⭐ Favorite' : `📁 ${task.title}`}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* New Task Name input (only shown if creating new task) */}
                    {selectedTaskId === 'new' && (
                        <div style={{ marginBottom: '18px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                New Task Name
                            </label>
                            <input
                                type="text"
                                autoFocus
                                value={taskName}
                                onChange={(e) => setTaskName(e.target.value)}
                                placeholder="e.g. Oncology Labeling Research"
                                style={{
                                    width: '100%',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    border: '2px solid #e2e8f0',
                                    fontSize: '0.95rem',
                                    outline: 'none',
                                    boxSizing: 'border-box'
                                }}
                                onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                                onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                            />
                        </div>
                    )}

                    {/* Tags Input */}
                    <div style={{ marginBottom: '28px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Tags (comma-separated)
                        </label>
                        <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="e.g. Priority, Review Needed"
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                border: '2px solid #e2e8f0',
                                fontSize: '0.95rem',
                                outline: 'none',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                        />
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={() => {
                                setTaskName('');
                                setTagsInput('');
                                setSelectedTaskId('new');
                                onClose();
                            }}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: 'none',
                                fontSize: '0.85rem',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={selectedTaskId === 'new' && !taskName.trim()}
                            style={{
                                padding: '10px 24px',
                                backgroundColor: '#6366f1',
                                color: '#fff',
                                borderRadius: '8px',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                cursor: (selectedTaskId === 'new' && !taskName.trim()) ? 'not-allowed' : 'pointer',
                                border: 'none',
                                opacity: (selectedTaskId === 'new' && !taskName.trim()) ? 0.5 : 1,
                                transition: 'background-color 0.2s',
                                boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.2)'
                            }}
                            onMouseEnter={(e) => { if (selectedTaskId !== 'new' || taskName.trim()) e.currentTarget.style.backgroundColor = '#4f46e5'; }}
                            onMouseLeave={(e) => { if (selectedTaskId !== 'new' || taskName.trim()) e.currentTarget.style.backgroundColor = '#6366f1'; }}
                        >
                            {selectedTaskId === 'new' ? 'Create & Add' : 'Add to Task'}
                        </button>
                    </div>
                </form>
            </div>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
};
