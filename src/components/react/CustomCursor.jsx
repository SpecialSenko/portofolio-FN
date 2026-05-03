/* BUGS / ISSUES
- When snapping to large targets for a long time, animation becomes slow due to accumulated velocity calculations.
- No dedicated animation or visual feedback when hovering an <img> element.
- Snap strength logic needs fine-tuning (too aggressive in some cases, too weak in others).
- Custom cursor style detection can be inconsistent if target element styles are dynamically updated.
- Border radius changes can feel "jumpy" when switching between elements with different cursor styles.
- Velocity-based stretching can jitter if the mouse moves very slowly.
- Cursor disappears instantly when leaving the window instead of fading smoothly.
- Possible performance cost due to `getBoundingClientRect()` being called every frame.

FEATURE IDEAS / IMPROVEMENTS
- Allow multiple predefined cursor styles (e.g., "fill-circle", "outline", "highlight", "blurred") and switch via data attributes. [DONE!]
- Add smooth fade-out animation when cursor becomes invisible (mouseleave).
- Add idle/random floating animation when the mouse is inactive for X seconds.
- Implement a "magnetic" effect where the cursor is gently pulled toward hoverable elements.
- When hovering over an image:
    - Make background transparent
    - Increase border thickness
    - Optionally add subtle scaling or rotation.
- Make snap strength configurable per element via `data-snap-strength`.
- Reduce unnecessary DOM reads by caching element rects when possible.
- Add touch support fallback for mobile devices (maybe show a tap ripple instead).
- Allow theme-based gradient/color changes for the cursor.
- Add blend mode changes depending on background brightness.
- Expose cursor style change through a global API so it can be triggered by other components.

POSSIBLE PERFORMANCE OPTIMIZATIONS
- Throttle or debounce expensive DOM reads.
- Move cursor style detection out of the per-frame loop if not needed continuously.
- Reuse calculated values when cursor hovers the same element for multiple frames.
- Consider `requestIdleCallback` for low-priority style updates.
*/

import { useEffect, useRef, useState } from "react";
import { isMobileDevice } from "../../function/isMobileDevice";
import { createAnimatable } from "animejs";

const speed = 0.27;
const defaultSize = 28.5;

const circle = { x: 0, y: 0 };
const cursorPosition = {
    x: 0,
    y: 0,
    isVisible: true,
    previousMousePosition: { x: 0, y: 0 },
    cursorHoverEl: null,
};

const handleMouseMove = (e) => {
    cursorPosition.x = e.clientX;
    cursorPosition.y = e.clientY;
    cursorPosition.isVisible = true;
    cursorPosition.cursorHoverEl = e.target;
};

const handleMouseLeave = () => {
    cursorPosition.isVisible = false;
};

export let mouseDefaultStyle = "fill-circ";
export function CustomCursor() {
    const [isBackground, setBackground] = useState("bg-gradient-to-br from-cyan-300 via-indigo-500 to-fuchsia-400 ")
    const cursorRef = useRef(null);
    const animationFrameId = useRef(null);
    const [isText, setIsText] = useState(true);

    useEffect(() => {
        if (isMobileDevice()) return;

        const cursor = cursorRef.current;
        if (!cursor) return;

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseleave", handleMouseLeave);

        const animCursor = createAnimatable(cursor, {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            ease: "cubic-bezier(.19,-0.41,.5,2.08)",
            width: { duration: 80, ease: "inOutQuad" },
            height: { duration: 80, ease: "inOutQuad" },
            borderRadius: { duration: 80, ease: "inOutQuad" },
            rotation: { duration: 50, ease: "inOutQuad" },
        });

        const liquid = {
            velocityX: 0,
            velocityY: 0,
        };

        let lastX = circle.x;
        let lastY = circle.y;
        let lastHoveredEl = null;
        let cachedRect = null;

        const tick = () => {
            const { cursorHoverEl, isVisible, previousMousePosition } = cursorPosition;

            // Cache rect only when hover target changes
            if (cursorHoverEl !== lastHoveredEl) {
                lastHoveredEl = cursorHoverEl;
                cachedRect = cursorHoverEl?.getBoundingClientRect() || null;
            }

            if (isVisible && cachedRect) {
                const cursorStyle = window.getComputedStyle(cursorHoverEl).cursor;
                const fontSize = parseFloat(getComputedStyle(cursorHoverEl).fontSize);
                const isCustomStyle = cursorHoverEl?.getAttribute("data-cursor-style");

                const snapStrength =
                    isCustomStyle !== "none" && isCustomStyle !== "line-text" && cursorStyle !== "auto" && cursorStyle !== "pointer"
                        ? 0.98
                        : 0;

                const targetX =
                    (1 - snapStrength) * cursorPosition.x + snapStrength * (cachedRect.x + cachedRect.width / 2);
                const targetY =
                    (1 - snapStrength) * cursorPosition.y + snapStrength * (cachedRect.y + cachedRect.height / 2);

                // Smooth follow
                circle.x += (targetX - circle.x) * speed;
                circle.y += (targetY - circle.y) * speed;

                // Velocity for stretch
                liquid.velocityX = circle.x - lastX;
                liquid.velocityY = circle.y - lastY;

                const angle = Math.atan2(liquid.velocityY, liquid.velocityX);
                const velocity = Math.hypot(liquid.velocityX, liquid.velocityY);
                const stretchFactor = Math.min(velocity * 0.05, 1);

                animCursor.x(circle.x - cursor.offsetWidth / 2);
                animCursor.y(circle.y - cursor.offsetHeight / 2);
                animCursor.scaleX(1 + Math.abs(Math.cos(angle)) * stretchFactor);
                animCursor.scaleY(1 + Math.abs(Math.sin(angle)) * stretchFactor);
                animCursor.skewX(Math.sin(angle) * stretchFactor * 10);
                animCursor.skewY(Math.cos(angle) * stretchFactor * 10);
                animCursor.rotation(angle * (180 / Math.PI));

                setIsText(cursorStyle !== "pointer");

                // DEFAULT STYLE
                setBackground("bg-gradient-to-br from-cyan-300 via-indigo-500 to-fuchsia-400 ");

                //* APPLY THE CUSTOM STYLE RIGHT HERE
                switch (isCustomStyle) {
                    case "bg-transparent":
                        console.log("we have a bg-transparent cursor");
                        animCursor.width(defaultSize * 0.5);
                        setBackground("bg-transparent");
                        break;
                    case "line-text":
                        animCursor.width(8); // thin vertical line
                        animCursor.height(fontSize * 1.5); // slightly taller than font size for breathing room
                        animCursor.borderRadius(5);

                        setBackground(
                            "bg-transparent border-l-[2px] border-emerald-400 shadow-[0_0_8px_#34d399]/70"
                        );
                        break;
                    case "tooltip-skill":
                        console.warn("it does work")
                        animCursor.width(defaultSize * 1.2);
                        animCursor.height(defaultSize * 1.2);
                        animCursor.borderRadius(8);
                        setBackground(
                            "bg-gradient-to-br from-emerald-400 via-lime-400 to-yellow-300 shadow-[0_0_10px_#a3e635]/70 border border-white/20"
                        );
                        break;
                    default:

                        if (isCustomStyle !== "none" && cursorStyle !== "pointer") {
                            animCursor.width(cursorStyle === "auto" ? defaultSize : cachedRect.width + 5);
                            animCursor.height(cursorStyle === "auto" ? defaultSize : cachedRect.height + 5);
                            animCursor.borderRadius(cursorStyle === "auto" ? 100 : 4);
                        } else if (cursorStyle === "pointer") {
                            animCursor.width(defaultSize * 0.5);
                            animCursor.height(defaultSize * 0.5);
                            animCursor.borderRadius(12);
                        }/*  else {
                            console.log("we have a default cursor");
                            animCursor.width(defaultSize);
                            setBackground("bg-gradient-to-br from-cyan-300 via-indigo-500 to-fuchsia-400 ");
                        } */
                        break;
                }

            } else {
                // Hidden state (fade-out feel by not instantly snapping)
                circle.x += (previousMousePosition.x - circle.x) * 0.2;
                circle.y += (previousMousePosition.y - circle.y) * 0.2;
                animCursor.x(circle.x - cursor.offsetWidth / 2);
                animCursor.y(circle.y - cursor.offsetHeight / 2);
                animCursor.width(defaultSize);
                animCursor.height(defaultSize);
                animCursor.borderRadius(50);
            }

            lastX = circle.x;
            lastY = circle.y;
            cursorPosition.previousMousePosition.x = circle.x;
            cursorPosition.previousMousePosition.y = circle.y;

            animationFrameId.current = requestAnimationFrame(tick);
        };

        animationFrameId.current = requestAnimationFrame(tick);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseleave", handleMouseLeave);
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, []);

    return (
        <div
            ref={cursorRef}
            className={`custom-cursor pointer-events-none fixed
            ${isMobileDevice() ? "hidden" : ""}
            z-[9999] w-7 h-7 rounded-full 
            ${isBackground}
            shadow-[0_0_10px_#89f0ff] border border-white/20 ring-2 ring-cyan-400/30 
            backdrop-blur-sm transition-all duration-150 ease-out
            ${isText ? "mix-blend-screen" : "mix-blend-normal"}
            `}
        />
    );
}

// pls use this cause it took my whole life to make this work perfectly