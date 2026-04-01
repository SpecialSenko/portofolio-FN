import React, { useMemo, useCallback } from "react";
import { animate, stagger } from "animejs";
import { isMobileDevice } from "../../function/isMobileDevice";

export const GRID_WIDTH = 100;
export const GRID_HEIGHT = 6;

export default function GridGen() {
    let animating = false;

    const handleClick = useCallback((e) => {
        if (animating && isMobileDevice) return;
        animating = true;

        animate(".bg-cell", {
            opacity: [0.3, 0],
            backgroundColor: [
                "rgba(255, 255, 255, 0.12)",
                "rgba(255, 255, 255, 0)"
            ],
            translateX: [-12, 0],
            translateY: [-12, 0],
            borderColor: [
                "rgba(120, 120, 120, 0.35)",
                "rgba(120, 120, 120, 0.1)"
            ],
            boxShadow: [
                "0 4px 8px rgba(255,255,255,0.15)",
                "0 0 0 rgba(0,0,0,0)"
            ],
            delay: stagger(40, {
                grid: [GRID_WIDTH, GRID_HEIGHT],
                from: 0
            }),
            duration: 420,
            easing: "easeOutQuad",
            onComplete: () => {
                animating = false;
            }
        });
    }, []);

    const cells = useMemo(() => {
        return Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, (_, i) => (
            <div
                key={i}
                className="bg-cell w-full aspect-square bg-transparent border border-[rgba(120,120,120,0.1)]"
                onClick={handleClick}
            />
        ));
    }, [handleClick]);

    return <>{cells}</>;
}
