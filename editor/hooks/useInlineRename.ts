import { useState, useCallback } from 'react';

export interface InlineRenameState {
    /** ID of the entity/node currently being renamed, or null if none */
    renamingId: string | null;
    /** Current temporary text value inside the rename input field */
    renameValue: string;
    /** Begin renaming a specific item with its initial label */
    startRename: (id: string, initialName: string) => void;
    /** Cancel the current rename action without applying changes */
    cancelRename: () => void;
    /** Update the temporary text value */
    setRenameValue: (val: string) => void;
    /**
     * Submit and commit the rename action.
     * Only invokes `onCommit` if the trimmed new value is non-empty.
     */
    submitRename: (onCommit: (id: string, newName: string) => void) => void;
    /** Helper to check if a specific item is actively being renamed */
    isRenaming: (id: string) => boolean;
}

/**
 * Shared hook for managing inline renaming state across tree views and lists.
 * Prevents redundant local states and ensures uniform keyboard/commit lifecycles.
 */
export function useInlineRename(): InlineRenameState {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState<string>('');

    const startRename = useCallback((id: string, initialName: string) => {
        setRenamingId(id);
        setRenameValue(initialName);
    }, []);

    const cancelRename = useCallback(() => {
        setRenamingId(null);
        setRenameValue('');
    }, []);

    const submitRename = useCallback((onCommit: (id: string, newName: string) => void) => {
        if (renamingId) {
            const trimmed = renameValue.trim();
            if (trimmed) {
                onCommit(renamingId, trimmed);
            }
        }
        setRenamingId(null);
        setRenameValue('');
    }, [renamingId, renameValue]);

    const isRenaming = useCallback((id: string) => renamingId === id, [renamingId]);

    return {
        renamingId,
        renameValue,
        startRename,
        cancelRename,
        setRenameValue,
        submitRename,
        isRenaming,
    };
}
