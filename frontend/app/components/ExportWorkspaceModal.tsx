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
            backgroundColor: 'rgba(7, 31, 61, 0.58)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1.25rem'
        }}>
            <div style={{
                backgroundColor: 'var(--fdl-paper, #ffffff)',
                border: '1px solid var(--fdl-line, #b8c8d7)',
                borderTop: '3px solid var(--fdl-blue-600, #0071bc)',
                borderRadius: 'var(--fdl-radius-sm, 2px)',
                padding: '24px 28px',
                width: '100%',
                maxWidth: '480px',
                boxShadow: '0 16px 36px rgba(7, 31, 61, 0.24)'
            }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '6px', marginTop: 0 }}>
                    Export to Dashboard
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--fdl-muted, #5e6e7c)', marginBottom: '20px', lineHeight: 1.5 }}>
                    Select a task to export the labeling list to, or create a new one. You can also assign tags.
                </p>

                <form onSubmit={handleSubmit}>
                    {/* Task Selection Dropdown */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--fdl-navy-800, #12375b)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                                minHeight: '34px',
                                padding: '6px 10px',
                                borderRadius: 'var(--fdl-radius-sm, 2px)',
                                border: '1px solid var(--fdl-line, #b8c8d7)',
                                fontSize: '0.85rem',
                                color: 'var(--fdl-ink, #132332)',
                                backgroundColor: 'var(--fdl-paper, #ffffff)',
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
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--fdl-navy-800, #12375b)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                                    minHeight: '34px',
                                    padding: '6px 10px',
                                    borderRadius: 'var(--fdl-radius-sm, 2px)',
                                    border: '1px solid var(--fdl-line, #b8c8d7)',
                                    fontSize: '0.85rem',
                                    color: 'var(--fdl-ink, #132332)',
                                    backgroundColor: 'var(--fdl-paper, #ffffff)',
                                    outline: 'none',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                    )}

                    {/* Tags Input */}
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--fdl-navy-800, #12375b)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Tags (comma-separated)
                        </label>
                        <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="e.g. Priority, Review Needed"
                            style={{
                                width: '100%',
                                minHeight: '34px',
                                padding: '6px 10px',
                                borderRadius: 'var(--fdl-radius-sm, 2px)',
                                border: '1px solid var(--fdl-line, #b8c8d7)',
                                fontSize: '0.85rem',
                                color: 'var(--fdl-ink, #132332)',
                                backgroundColor: 'var(--fdl-paper, #ffffff)',
                                outline: 'none',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                            type="button"
                            onClick={() => {
                                setTaskName('');
                                setTagsInput('');
                                setSelectedTaskId('new');
                                onClose();
                            }}
                            style={{
                                minHeight: '32px',
                                padding: '0.45rem 0.8rem',
                                backgroundColor: 'var(--fdl-paper, #ffffff)',
                                color: 'var(--fdl-ink-soft, #273843)',
                                borderRadius: 'var(--fdl-radius-sm, 2px)',
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: '1px solid var(--fdl-line, #b8c8d7)',
                                fontSize: '0.8rem'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={selectedTaskId === 'new' && !taskName.trim()}
                            style={{
                                minHeight: '32px',
                                padding: '0.45rem 1rem',
                                backgroundColor: 'var(--fdl-blue-700, #0759a5)',
                                color: 'var(--fdl-paper, #ffffff)',
                                borderRadius: 'var(--fdl-radius-sm, 2px)',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: (selectedTaskId === 'new' && !taskName.trim()) ? 'not-allowed' : 'pointer',
                                border: '1px solid var(--fdl-blue-700, #0759a5)',
                                opacity: (selectedTaskId === 'new' && !taskName.trim()) ? 0.5 : 1
                            }}
                        >
                            {selectedTaskId === 'new' ? 'Create & Add' : 'Add to Task'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
