
import React from 'react';

interface WorkspaceShellProps {
    children: React.ReactNode;
}

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({ children }) => {
    return (
        <div className="w-full h-full bg-black relative overflow-hidden select-none">
            {children}
        </div>
    );
};

