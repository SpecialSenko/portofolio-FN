import { useEffect, useState } from "react";
import SkillsBox from "./SkillsBox";
import SkillTooltip from "./SkillTooltip";
import { isMobileDevice } from "../../function/isMobileDevice";
import LineSkills from "./LineSkills";
import { animate, onScroll } from "animejs";
import { baseSkills } from "../../data/skillsData";
/* 
            < SkillsBox
                key={i}
                title={skill.title}
                progress={skill.progress}
                skillsID={skill.id}
                index={i}
                icon={skill.id}
                total={baseSkills.length}
            />
*/
export function SkillsCollection() {
  const [isShrink, setShrinking] = useState(false);
  const [showContent, setShowContent] = useState(false);
  useEffect(() => {
    animate("#circle-of-skills", {
      width: "600px",
      height: "600px",
      opacity: [0, 1],
      duration: 300,
      easing: "easeOutQuad",
      delay: 1200,
      autoplay: onScroll({}),
      onComplete: () => setShowContent(true),
    });
  }, []);

  // STYLING THE CONTAINER, AND THEN MOVE ON TO THE MOBILE VIEW STAY CIHUYYYY
  return !isMobileDevice() ? (
    <>
      <SkillTooltip />
      <div
        id="circle-of-skills"
        className={` 
    absolute 
    w-[0px] 
    h-[0px] 
    p-10 
    bg-[#061452]/40  
    backdrop-blur-md 
    shadow-[0_0_40px_10px_rgba(255,255,255,0.2)] 
    border border-white/20  
    z-[-50]
    rounded-full
    transition-all
    duration-500`}
        style={{
          top: `50%`,
          left: `50%`,
          transform: "translate(-50%, -50%)",
        }}
        onMouseEnter={() => setShrinking(false)} // ✅ set true when mouse enters
        onMouseLeave={() => setShrinking(true)}
      >
        {showContent &&
          baseSkills.map((skill, i) => (
            <SkillsBox
              key={i}
              title={skill.title}
              progress={skill.progress}
              skillsID={skill.id}
              index={i}
              icon={skill.id}
              total={baseSkills.length}
            />
          ))}
        <LineSkills shrink={isShrink} />
      </div>
      {/* Cursor-following tooltip that appears in front of all elements */}
    </>
  ) : (
    <div
      className={` 
    absolute
    w-screen
    min-h-screen
    p-10
    bg-[#061452]/40
    backdrop-blur-lg
    z-[-50]
    transition-all
    duration-500
flex
justify-center
items-center
flex-wrap
`}
      style={{
        top: `0%`,
        left: `50%`,
        transform: "translate(-50%, -50%)",
      }}
      onMouseEnter={() => setShrinking(false)} // ✅ set true when mouse enters
      onMouseLeave={() => setShrinking(true)}
    >
      {showContent &&
        baseSkills.map((skill, i) => (
          <SkillsBox
            key={i}
            title={skill.title}
            progress={skill.progress}
            skillsID={skill.id}
            index={i}
            icon={skill.id}
            total={baseSkills.length}
          />
        ))}
    </div>
  );
}
