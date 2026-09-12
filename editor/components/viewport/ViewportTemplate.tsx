import React from 'react';

export interface ViewportTemplateProps {
  containerRef: React.Ref<HTMLDivElement>;
  canvasRef: React.Ref<HTMLCanvasElement>;
  className?: string;
  canvasClassName?: string;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  hudBottomLeft?: React.ReactNode;
  hudBottomRight?: React.ReactNode;
  viewportChildren?: React.ReactNode;
  overlayChildren?: React.ReactNode;
  containerProps?: Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'className'>;
  canvasProps?: Omit<React.CanvasHTMLAttributes<HTMLCanvasElement>, 'children' | 'className'>;
}

const joinClasses = (...classes: Array<string | undefined | false>) => classes.filter(Boolean).join(' ');

/**
 * Shared viewport DOM shell.
 *
 * Rendering engines stay outside this component. The template only owns the
 * canvas/overlay layout and the visual placement of reusable viewport chrome.
 * This keeps SceneView, AssetViewport3D and future preview editors visually
 * consistent without forcing them to share the same renderer lifecycle.
 */
export const ViewportTemplate: React.FC<ViewportTemplateProps> = ({
  containerRef,
  canvasRef,
  className,
  canvasClassName,
  toolbarLeft,
  toolbarRight,
  hudBottomLeft,
  hudBottomRight,
  viewportChildren,
  overlayChildren,
  containerProps,
  canvasProps,
}) => (
  <div
    {...containerProps}
    ref={containerRef}
    className={joinClasses(
      'relative w-full h-full overflow-hidden select-none bg-[#151515] group/viewport',
      className,
    )}
  >
    <canvas
      {...canvasProps}
      ref={canvasRef}
      className={joinClasses('block w-full h-full outline-none relative z-10', canvasClassName)}
    />

    {viewportChildren}

    {toolbarLeft && (
      <div
        className="absolute top-3 left-3 flex flex-wrap items-center gap-2 z-20 pointer-events-auto max-w-[calc(100%_-_5rem)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {toolbarLeft}
      </div>
    )}

    {toolbarRight && (
      <div
        className="absolute top-3 right-3 flex items-center gap-2 z-20 pointer-events-auto"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {toolbarRight}
      </div>
    )}

    {hudBottomLeft && (
      <div className="absolute bottom-2 left-2 z-20 pointer-events-none">{hudBottomLeft}</div>
    )}

    {hudBottomRight && (
      <div className="absolute bottom-2 right-2 z-20 pointer-events-none">{hudBottomRight}</div>
    )}

    {overlayChildren}
  </div>
);

export interface ViewportToolbarGroupProps {
  children: React.ReactNode;
  className?: string;
}

export const ViewportToolbarGroup: React.FC<ViewportToolbarGroupProps> = ({ children, className }) => (
  <div
    className={joinClasses(
      'bg-black/40 backdrop-blur border border-white/5 rounded-md flex items-center p-1 text-text-secondary',
      className,
    )}
  >
    {children}
  </div>
);

export interface ViewportIconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  label: string;
  active?: boolean;
}

export const ViewportIconButton: React.FC<ViewportIconButtonProps> = ({
  label,
  active = false,
  className,
  type = 'button',
  children,
  ...props
}) => (
  <button
    {...props}
    type={type}
    title={label}
    aria-label={label}
    className={joinClasses(
      'p-1 hover:text-white rounded hover:bg-white/10 transition-colors',
      active && 'text-accent',
      className,
    )}
  >
    {children}
  </button>
);

export interface ViewportHudProps {
  children: React.ReactNode;
  className?: string;
}

export const ViewportHud: React.FC<ViewportHudProps> = ({ children, className }) => (
  <div
    className={joinClasses(
      'text-[10px] text-text-secondary bg-black/40 px-2.5 py-1 rounded backdrop-blur border border-white/5 flex flex-col',
      className,
    )}
  >
    {children}
  </div>
);
