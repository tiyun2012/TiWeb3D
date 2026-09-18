import React from 'react';

export interface ViewportTemplateProps {
  containerRef: React.Ref<HTMLDivElement>;
  canvasRef: React.Ref<HTMLCanvasElement>;
  className?: string;
  canvasClassName?: string;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  toolbarCenter?: React.ReactNode;
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
  toolbarCenter,
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

    {(toolbarLeft || toolbarCenter || toolbarRight) && (
      <div
        className="absolute left-3 right-3 top-3 z-30 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 pointer-events-none"
      >
        <div
          className="min-w-0 justify-self-start flex max-w-full flex-wrap items-center gap-2 pointer-events-auto"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {toolbarLeft}
        </div>

        <div
          className="justify-self-center flex items-center gap-2 pointer-events-auto"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {toolbarCenter}
        </div>

        <div
          className="min-w-0 justify-self-end flex items-center gap-2 pointer-events-auto"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {toolbarRight}
        </div>
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
