import { useEffect, useState, useRef } from "react";

export default function SkillTooltip() {
    const [tooltip, setTooltip] = useState({
        visible: false,
        x: 0,
        y: 0,
        data: null
    });

    const tooltipRef = useRef(null);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (tooltip.visible) {
                setTooltip(prev => ({
                    ...prev,
                    x: e.clientX,
                    y: e.clientY
                }));
            }
        };

        const handleSkillHover = (e) => {
            setTooltip({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                data: e.detail
            });
        };

        const handleSkillUnhover = () => {
            setTooltip(prev => ({ ...prev, visible: false }));
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("skill-hover", handleSkillHover);
        window.addEventListener("skill-unhover", handleSkillUnhover);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("skill-hover", handleSkillHover);
            window.removeEventListener("skill-unhover", handleSkillUnhover);
        };
    }, [tooltip.visible]);

    if (!tooltip.visible || !tooltip.data) return null;

    const { data } = tooltip;

    // --- Make tooltip stick right to the cursor ---
    const offsetX = -500; // distance to right of cursor
    const offsetY = -400; // distance below cursor
    let x = tooltip.x + offsetX;
    let y = tooltip.y + offsetY;

    return (
        <div
            ref={tooltipRef}
            className="fixed pointer-events-none z-[9999] transition-all duration-150 ease-out"
            style={{
                left: `${x}px`,
                top: `${y}px`,
            }}
        >
            <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-xl p-4 shadow-2xl max-w-[280px] min-w-[240px] relative animate-tooltipOpen">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-white text-lg">{data.title}</h3>
                    {data.proficiency && (
                        <div className="px-2 py-1 rounded-full text-xs font-medium border bg-gray-700/50 text-gray-200">
                            {data.proficiency}
                        </div>
                    )}
                </div>

                {/* Description */}
                <p className="text-gray-300 text-sm mb-3 leading-relaxed">
                    {data.description}
                </p>

                {/* Progress Bar */}
                {data.progress !== undefined && (
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-gray-400 text-xs">Competency Level</span>
                            <span className="text-white text-xs font-medium">{data.progress}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300"
                                style={{ width: `${data.progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Bottom decoration */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-b-xl opacity-50" />
            </div>

            {/* Glow effect */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 rounded-xl blur-md opacity-50" />
        </div>
    );
}