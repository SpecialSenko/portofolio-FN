import { Icon } from "@iconify/react";
import { animate, stagger } from "animejs";
import { useEffect } from "react";
import { skillsData } from "../../data/skillsData";
import { isMobileDevice } from "../../function/isMobileDevice";

// Sanitize string to make valid ID
function safeId(str) {
  return str.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export default function SkillsBox({
  title,
  progress,
  skillsID,
  index,
  icon,
  total,
}) {
  const safeSkillsID = safeId(skillsID || "home");

  // Fixed radius (no randomness)
  const radius = 250; // pick a number in the 160–240 range
  const angle = (2 * Math.PI * index) / total;

  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  useEffect(() => {
    animate(`#${safeSkillsID}`, {
      opacity: [0, 1],
      scale: [0.2, 1],
      top: ["50%", `calc(50% + ${y}px)`],
      left: ["50%", `calc(50% + ${x}px)`],
      duration: index * 50 + total * 20, // Stagger based on index
      delay: stagger(100, { start: 500 }), // Staggered delay
      composition: "blend",
      ease: "inOutBounce",

      onComplete: () => {
        animate(`#${safeSkillsID} svg circle:nth-child(2)`, {
          strokeDashoffset: [
            `${2 * Math.PI * 28}`,
            `${2 * Math.PI * 28 * (1 - progress / 100)}`,
          ],
          duration: 800,
          ease: "inOutBounce",
          alternate: true,
        });
      },
    });
  }, [x, y, index, safeSkillsID, progress]);

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + window.scrollX;
    const y = rect.top + rect.height / 2 + window.scrollY;

    // Get skill information from centralized data
    const skillInfo = skillsData[skillsID] || {
      title: title || "Technology",
      description: "Technology",
      proficiency: "Beginner",
    };

    window.dispatchEvent(
      new CustomEvent("skill-hover", {
        detail: {
          x,
          y,
          title: skillInfo.title,
          description: skillInfo.description,
          proficiency: skillInfo.proficiency,
          progress,
        },
      }),
    );
  };

  const handleMouseLeave = () => {
    window.dispatchEvent(new Event("skill-unhover"));
  };

  return !isMobileDevice() ? (
    <>
      <div
        id={safeSkillsID}
        className="skills absolute group p-3 bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-xl shadow-2xl z-10 cursor-pointer"
        style={{
          top: `50%`,
          left: `50%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: "rgba(25, 25, 25, 0.5)",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Icon
          icon={`devicon:${icon}`}
          width={40}
          className="transition-transform duration-300 group-hover:scale-110 z-10 
             drop-shadow-[0_0_5px_rgba(255,255,255,0.6)]"
        />
      </div>
    </>
  ) : (
    <div
      className="
        p-3 
        bg-gray-900/95 
        backdrop-blur-md 
        border 
        border-gray-700/50 
        rounded-xl 
        shadow-2xl 
        z-10 
        "
    >
      <Icon
        icon={`devicon:${icon}`}
        width={40}
        className="transition-transform duration-300 group-hover:scale-110 z-10 
             drop-shadow-[0_0_5px_rgba(255,255,255,0.6)]"
      />
    </div>
  );
}
