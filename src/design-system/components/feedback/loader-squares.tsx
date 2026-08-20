import { cn } from '../../theme/utils';

interface LoaderSquaresProps {
  activate?: boolean;
  scale?: number;
  className?: string;
}

const PRIMARY = 'var(--primary)';
const PRIMARY_FADED = 'color-mix(in srgb, var(--primary) 15%, transparent)';
const SECONDARY_DARK = 'var(--primary-strong)';

export function LoaderSquares({ activate = true, scale, className }: LoaderSquaresProps) {
  const scaleStyle = scale ? { transform: `scale(${scale})` } : undefined;

  return (
    <>
      <style>{`
        .loader-squares-container {
          display: grid;
          grid-template-columns: repeat(2, 18px);
          gap: 6px;
        }

        .loader-square {
          position: relative;
          width: 18px;
          height: 18px;
          background-color: ${PRIMARY};
          border-radius: 4px;
        }

        .loader-squares-container.activate > .square-1,
        .loader-squares-container:hover > .square-1 {
          animation: 5s infinite loader-square-1;
        }

        .loader-squares-container.activate > .square-2,
        .loader-squares-container:hover > .square-2 {
          animation: 5s infinite loader-square-2;
        }

        .loader-squares-container.activate > .square-3,
        .loader-squares-container:hover > .square-3 {
          animation: 5s infinite loader-square-3;
        }

        .loader-squares-container.activate > .square-4,
        .loader-squares-container:hover > .square-4 {
          animation: 5s infinite loader-square-4;
        }

        .loader-squares-container.activate > .square-5,
        .loader-squares-container:hover > .square-5 {
          animation: 5s infinite loader-square-5;
        }

        .loader-squares-container.activate > .square-6 {
          animation: 5s infinite loader-square-6;
        }
        .loader-squares-container:hover > .square-6 {
          animation: 5s loader-square-6;
        }

        @keyframes loader-square-1 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY};
            border-radius: 4px 0 0 0;
          }
          28% {
            background-color: ${PRIMARY};
            border-radius: 4px 0 0 0;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 12px 0 0 0;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 12px 0 0 0;
          }
          60% {
            background-color: ${PRIMARY};
            border-radius: 6px 0 0 6px;
          }
          68% {
            background-color: ${PRIMARY};
            border-radius: 6px 0 0 6px;
          }
          80% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          88% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
        }

        @keyframes loader-square-2 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          28% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          60% {
            background-color: ${PRIMARY};
            border-radius: 0 0 0 0;
          }
          68% {
            background-color: ${PRIMARY};
            border-radius: 0 0 0 0;
          }
          80% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          88% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
        }

        @keyframes loader-square-3 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY_FADED};
            border-radius: 0;
          }
          28% {
            background-color: ${PRIMARY_FADED};
            border-radius: 0;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 0 14px;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 0 14px;
          }
          60% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          68% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          80% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          88% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
        }

        @keyframes loader-square-4 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY};
            border-radius: 0 14px 14px 0;
          }
          28% {
            background-color: ${PRIMARY};
            border-radius: 0 14px 14px 0;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 0 14px 0 4px;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 0 14px 0 4px;
          }
          60% {
            background-color: ${PRIMARY};
            border-radius: 0;
          }
          68% {
            background-color: ${PRIMARY};
            border-radius: 0;
          }
          80% {
            background-color: ${SECONDARY_DARK};
            border-radius: 4px;
          }
          88% {
            background-color: ${SECONDARY_DARK};
            border-radius: 4px;
          }
        }

        @keyframes loader-square-5 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY};
            border-radius: 0 0 0 4px;
          }
          28% {
            background-color: ${PRIMARY};
            border-radius: 0 0 0 4px;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 4px 0 0 4px;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 4px 0 0 4px;
          }
          60% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          68% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          80% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          88% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
        }

        @keyframes loader-square-6 {
          0% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          8% {
            background-color: ${PRIMARY};
            border-radius: 4px;
          }
          20% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          28% {
            background-color: ${PRIMARY};
            border-radius: 0 4px 4px 0;
          }
          40% {
            background-color: ${PRIMARY};
            border-radius: 0 0 12px 0;
          }
          48% {
            background-color: ${PRIMARY};
            border-radius: 0 0 12px 0;
          }
          60% {
            background-color: ${PRIMARY};
            border-radius: 0 0 4px 4px;
          }
          68% {
            background-color: ${PRIMARY};
            border-radius: 0 0 4px 4px;
          }
          80% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
          88% {
            background-color: ${PRIMARY_FADED};
            border-radius: 4px;
          }
        }
      `}</style>
      <div
        className={cn('loader-squares-container', activate && 'activate', className)}
        style={scaleStyle}
      >
        <span className="loader-square square-1" />
        <span className="loader-square square-2" />
        <span className="loader-square square-3" />
        <span className="loader-square square-4" />
        <span className="loader-square square-5" />
        <span className="loader-square square-6" />
      </div>
    </>
  );
}
