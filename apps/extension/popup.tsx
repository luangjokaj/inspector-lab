import { useEffect, useState } from "react";
import styled, { useTheme } from "styled-components";
import {
  Button,
  Callout,
  Flex,
  Icon,
  ThemeToggle,
  Toggle,
  alpha,
  styledSmall,
  styledText,
} from "cherry-styled-components";
import inspectorBundleUrl from "url:./injected/inspector-entry.tsx";
import { ThemeProvider } from "~lib/ThemeProvider";
import {
  readCustomThemeSetting,
  saveColorSchemeSetting,
  saveCustomThemeSetting,
} from "~lib/settings";
import {
  clearDiagnostics,
  installGlobalDiagnostics,
  readDiagnostics,
  type DiagnosticEntry,
} from "~lib/diagnostics";

import "./popup.css";

installGlobalDiagnostics("popup");

const PopupShell = styled.main`
  display: flex;
  flex-direction: column;
  /* padding.xs and gridGap.xs are both 20px: one rhythm everywhere, and the
     popup hugs its content — no forced min-height. */
  gap: ${({ theme }) => theme.spacing.gridGap.xs};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.padding.xs};
  box-sizing: border-box;
  color: ${({ theme }) => theme.colors.dark};
  /* A vertical band that peaks halfway down and fades to nothing at both ends,
     so the top and bottom edges are the bare surface — pure white in light
     mode, near-black in dark — and only the middle carries the brand tint. */
  background:
    linear-gradient(
      180deg,
      transparent,
      ${({ theme }) => alpha(theme.colors.primary, 13)} 50%,
      transparent
    ),
    ${({ theme }) => theme.colors.light};
`;

const Header = styled.header`
  padding-bottom: ${({ theme }) => theme.spacing.gridGap.xs};
  border-bottom: solid 1px ${({ theme }) => theme.colors.grayLight};
`;

/**
 * The wordmark keeps its brand teal and amber, while the "Inspector Lab"
 * text paths are fill="currentColor" so they follow the theme — the shipped
 * near-white fill would disappear on the light popup.
 */
const LogoTitle = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.dark};
  line-height: 0;

  svg {
    width: 176px;
    height: auto;
  }
`;

function Logo() {
  return (
    <LogoTitle aria-label="Inspector Lab - DevTools">
      <svg
        aria-hidden="true"
        width="1012"
        height="249"
        viewBox="0 0 1012 249"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M35.2954 69.863V50.9418C35.2954 42.3005 42.3005 35.2954 50.9418 35.2954H69.863C72.8774 35.2954 75.3211 37.739 75.3211 40.7534C75.3211 43.7678 72.8774 46.2115 69.863 46.2115H50.9418C48.3293 46.2115 46.2115 48.3293 46.2115 50.9418V69.863C46.2115 72.8774 43.7678 75.3211 40.7534 75.3211C37.739 75.3211 35.2954 72.8774 35.2954 69.863Z"
          fill="#2ED3C3"
        />
        <path
          d="M140.09 69.863V50.9418C140.09 48.3293 137.972 46.2115 135.36 46.2115H116.438C113.424 46.2115 110.98 43.7678 110.98 40.7534C110.98 37.739 113.424 35.2954 116.438 35.2954H135.36C144.001 35.2954 151.006 42.3005 151.006 50.9418V69.863C151.006 72.8774 148.562 75.3211 145.548 75.3211C142.534 75.3211 140.09 72.8774 140.09 69.863Z"
          fill="#2ED3C3"
        />
        <path
          d="M140.09 135.36V116.438C140.09 113.424 142.534 110.98 145.548 110.98C148.562 110.98 151.006 113.424 151.006 116.438V135.36C151.006 144.001 144.001 151.006 135.36 151.006H116.438C113.424 151.006 110.98 148.562 110.98 145.548C110.98 142.534 113.424 140.09 116.438 140.09H135.36C137.972 140.09 140.09 137.972 140.09 135.36Z"
          fill="#2ED3C3"
        />
        <path
          d="M35.2954 135.36V116.438C35.2954 113.424 37.739 110.98 40.7534 110.98C43.7678 110.98 46.2115 113.424 46.2115 116.438V135.36C46.2115 137.972 48.3293 140.09 50.9418 140.09H69.863C72.8774 140.09 75.3211 142.534 75.3211 145.548C75.3211 148.562 72.8774 151.006 69.863 151.006H50.9418C42.3005 151.006 35.2954 144.001 35.2954 135.36Z"
          fill="#2ED3C3"
        />
        <path
          d="M76.2307 68.8078L123.552 92.0045L102.211 100.355L93.8602 121.696L76.2307 68.8078Z"
          fill="#F2B84B"
        />
        <path
          d="M74.6024 66.943C75.3529 66.2876 76.423 66.1499 77.3178 66.5882L124.639 89.7849C125.52 90.2168 126.067 91.1287 126.026 92.1091C125.985 93.0887 125.366 93.9532 124.453 94.3105L104.121 102.266L96.1662 122.597C95.7866 123.567 94.8379 124.197 93.7965 124.171C92.7553 124.144 91.8427 123.467 91.5133 122.479L73.8838 69.5901C73.5684 68.6441 73.8516 67.5993 74.6024 66.943ZM94.0422 114.428L99.905 99.4547L100.142 98.9999C100.421 98.5736 100.828 98.238 101.31 98.0493L117.412 91.7452L80.4425 73.6245L94.0422 114.428Z"
          fill="#F2B84B"
        />
        <path
          d="M948.799 135.068V46.9987H964.366V79.9389H965.011C965.814 78.3335 966.947 76.6277 968.409 74.8216C969.871 72.9868 971.849 71.4243 974.343 70.1343C976.837 68.8155 980.019 68.1561 983.89 68.1561C988.993 68.1561 993.594 69.4605 997.694 72.0694C1001.82 74.6496 1005.09 78.4768 1007.5 83.5511C1009.93 88.5968 1011.15 94.7892 1011.15 102.128C1011.15 109.381 1009.96 115.545 1007.58 120.62C1005.2 125.694 1001.97 129.564 997.866 132.23C993.766 134.896 989.122 136.23 983.933 136.23C980.148 136.23 977.009 135.599 974.515 134.337C972.021 133.076 970.014 131.557 968.495 129.779C967.004 127.973 965.843 126.267 965.011 124.662H964.108V135.068H948.799ZM964.065 102.042C964.065 106.314 964.667 110.055 965.871 113.266C967.104 116.477 968.867 118.985 971.161 120.792C973.483 122.569 976.292 123.458 979.589 123.458C983.03 123.458 985.911 122.54 988.233 120.706C990.555 118.842 992.304 116.305 993.479 113.094C994.683 109.855 995.285 106.171 995.285 102.042C995.285 97.9427 994.698 94.3018 993.522 91.1196C992.347 87.9374 990.598 85.4433 988.276 83.6371C985.954 81.831 983.058 80.928 979.589 80.928C976.264 80.928 973.44 81.8024 971.118 83.5511C968.796 85.2999 967.033 87.7511 965.828 90.9046C964.653 94.0582 964.065 97.7707 964.065 102.042Z"
          fill="currentColor"
        />
        <path
          d="M900.005 136.402C895.819 136.402 892.049 135.656 888.695 134.165C885.37 132.646 882.732 130.41 880.783 127.457C878.862 124.504 877.901 120.863 877.901 116.534C877.901 112.807 878.59 109.726 879.966 107.289C881.342 104.852 883.22 102.902 885.599 101.44C887.979 99.9782 890.659 98.8745 893.641 98.1291C896.651 97.355 899.761 96.796 902.972 96.452C906.842 96.0506 909.982 95.6922 912.39 95.3769C914.798 95.0329 916.547 94.5168 917.636 93.8288C918.754 93.1121 919.313 92.0083 919.313 90.5176V90.2596C919.313 87.02 918.353 84.5115 916.432 82.7341C914.511 80.9566 911.745 80.0679 908.132 80.0679C904.32 80.0679 901.295 80.8993 899.059 82.5621C896.851 84.2248 895.361 86.1886 894.587 88.4534L880.052 86.3893C881.198 82.3757 883.091 79.0215 885.728 76.3267C888.366 73.6031 891.591 71.5677 895.404 70.2203C899.217 68.8442 903.431 68.1561 908.046 68.1561C911.229 68.1561 914.397 68.5288 917.55 69.2742C920.704 70.0196 923.585 71.2523 926.194 72.9724C928.802 74.6639 930.895 76.9717 932.472 79.8959C934.078 82.8201 934.88 86.4753 934.88 90.8616V135.068H919.915V125.995H919.399C918.453 127.83 917.12 129.55 915.4 131.155C913.709 132.732 911.573 134.008 908.993 134.982C906.441 135.929 903.445 136.402 900.005 136.402ZM904.047 124.963C907.172 124.963 909.881 124.346 912.175 123.114C914.468 121.852 916.231 120.19 917.464 118.125C918.726 116.061 919.356 113.811 919.356 111.374V103.59C918.869 103.992 918.037 104.364 916.862 104.709C915.715 105.053 914.425 105.354 912.992 105.612C911.558 105.87 910.139 106.099 908.735 106.3C907.33 106.5 906.111 106.672 905.079 106.816C902.757 107.131 900.679 107.647 898.844 108.364C897.009 109.08 895.561 110.084 894.501 111.374C893.44 112.635 892.909 114.269 892.909 116.276C892.909 119.143 893.956 121.308 896.049 122.77C898.142 124.232 900.808 124.963 904.047 124.963Z"
          fill="currentColor"
        />
        <path
          d="M815.518 135.068V46.9987H831.472V121.695H870.261V135.068H815.518Z"
          fill="currentColor"
        />
        <path
          d="M741.624 135.068V69.0162H756.718V80.0249H757.406C758.61 76.212 760.674 73.2735 763.598 71.2093C766.551 69.1165 769.92 68.0701 773.704 68.0701C774.564 68.0701 775.524 68.1131 776.585 68.1991C777.675 68.2565 778.578 68.3568 779.294 68.5002V82.8201C778.635 82.5907 777.589 82.3901 776.155 82.2181C774.75 82.0174 773.389 81.917 772.07 81.917C769.232 81.917 766.68 82.5334 764.415 83.7662C762.179 84.9702 760.416 86.6473 759.126 88.7975C757.836 90.9476 757.191 93.4275 757.191 96.237V135.068H741.624Z"
          fill="currentColor"
        />
        <path
          d="M699.183 136.359C692.733 136.359 687.142 134.939 682.412 132.101C677.682 129.263 674.012 125.293 671.403 120.19C668.823 115.087 667.533 109.123 667.533 102.3C667.533 95.4772 668.823 89.4998 671.403 84.3682C674.012 79.2365 677.682 75.2516 682.412 72.4134C687.142 69.5752 692.733 68.1561 699.183 68.1561C705.634 68.1561 711.224 69.5752 715.954 72.4134C720.685 75.2516 724.34 79.2365 726.92 84.3682C729.529 89.4998 730.833 95.4772 730.833 102.3C730.833 109.123 729.529 115.087 726.92 120.19C724.34 125.293 720.685 129.263 715.954 132.101C711.224 134.939 705.634 136.359 699.183 136.359ZM699.269 123.888C702.767 123.888 705.691 122.927 708.042 121.007C710.393 119.057 712.141 116.448 713.288 113.18C714.464 109.912 715.051 106.271 715.051 102.257C715.051 98.2151 714.464 94.5598 713.288 91.2916C712.141 87.9948 710.393 85.3716 708.042 83.4221C705.691 81.4727 702.767 80.4979 699.269 80.4979C695.686 80.4979 692.704 81.4727 690.325 83.4221C687.974 85.3716 686.211 87.9948 685.035 91.2916C683.889 94.5598 683.315 98.2151 683.315 102.257C683.315 106.271 683.889 109.912 685.035 113.18C686.211 116.448 687.974 119.057 690.325 121.007C692.704 122.927 695.686 123.888 699.269 123.888Z"
          fill="currentColor"
        />
        <path
          d="M660.484 69.0162V81.057H622.512V69.0162H660.484ZM631.887 53.1912H647.454V115.201C647.454 117.294 647.769 118.899 648.4 120.018C649.059 121.107 649.919 121.852 650.98 122.254C652.041 122.655 653.216 122.856 654.506 122.856C655.481 122.856 656.37 122.784 657.172 122.641C658.004 122.497 658.635 122.368 659.065 122.254L661.688 134.423C660.856 134.71 659.667 135.026 658.119 135.37C656.599 135.714 654.736 135.914 652.528 135.972C648.629 136.086 645.117 135.499 641.992 134.208C638.868 132.89 636.388 130.854 634.553 128.102C632.747 125.35 631.858 121.91 631.887 117.781V53.1912Z"
          fill="currentColor"
        />
        <path
          d="M588.844 136.359C582.25 136.359 576.588 134.911 571.858 132.015C567.156 129.12 563.53 125.12 560.978 120.018C558.455 114.886 557.194 108.98 557.194 102.3C557.194 95.5919 558.484 89.6719 561.064 84.5402C563.644 79.3799 567.285 75.3663 571.987 72.4994C576.717 69.6039 582.308 68.1561 588.758 68.1561C594.119 68.1561 598.864 69.1452 602.992 71.1233C607.149 73.0728 610.46 75.8393 612.926 79.4229C615.391 82.9778 616.796 87.1347 617.14 91.8937H602.261C601.659 88.7115 600.225 86.0596 597.961 83.9382C595.724 81.788 592.729 80.7129 588.973 80.7129C585.791 80.7129 582.996 81.573 580.587 83.2931C578.179 84.9846 576.302 87.4214 574.954 90.6036C573.635 93.7858 572.976 97.5987 572.976 102.042C572.976 106.543 573.635 110.414 574.954 113.653C576.273 116.864 578.122 119.344 580.501 121.093C582.91 122.813 585.733 123.673 588.973 123.673C591.267 123.673 593.316 123.243 595.122 122.383C596.957 121.494 598.491 120.218 599.724 118.555C600.956 116.893 601.802 114.872 602.261 112.492H617.14C616.767 117.165 615.391 121.308 613.012 124.92C610.632 128.503 607.393 131.313 603.293 133.348C599.193 135.355 594.377 136.359 588.844 136.359Z"
          fill="currentColor"
        />
        <path
          d="M519.914 136.359C513.291 136.359 507.572 134.982 502.755 132.23C497.968 129.449 494.284 125.522 491.704 120.448C489.124 115.345 487.833 109.338 487.833 102.429C487.833 95.6349 489.124 89.6719 491.704 84.5402C494.313 79.3799 497.953 75.3663 502.626 72.4994C507.299 69.6039 512.789 68.1561 519.097 68.1561C523.167 68.1561 527.009 68.8155 530.621 70.1343C534.262 71.4243 537.473 73.4311 540.254 76.1546C543.063 78.8782 545.271 82.347 546.876 86.5613C548.482 90.7469 549.285 95.7353 549.285 101.526V106.3H495.144V95.8069H534.363C534.334 92.8254 533.689 90.1736 532.427 87.8514C531.166 85.5006 529.403 83.6515 527.138 82.304C524.902 80.9566 522.293 80.2829 519.312 80.2829C516.129 80.2829 513.334 81.057 510.926 82.6051C508.518 84.1245 506.64 86.1313 505.293 88.6255C503.974 91.091 503.3 93.8001 503.271 96.753V105.913C503.271 109.754 503.974 113.051 505.379 115.803C506.783 118.527 508.747 120.62 511.27 122.082C513.793 123.515 516.746 124.232 520.129 124.232C522.393 124.232 524.443 123.916 526.278 123.286C528.113 122.626 529.704 121.666 531.051 120.405C532.399 119.143 533.416 117.581 534.105 115.717L548.639 117.351C547.722 121.193 545.973 124.547 543.393 127.414C540.842 130.252 537.573 132.46 533.588 134.036C529.604 135.585 525.045 136.359 519.914 136.359Z"
          fill="currentColor"
        />
        <path
          d="M417.409 159.838V69.0162H432.718V79.9389H433.621C434.423 78.3335 435.556 76.6277 437.018 74.8216C438.48 72.9868 440.458 71.4243 442.952 70.1343C445.446 68.8155 448.629 68.1561 452.499 68.1561C457.602 68.1561 462.203 69.4605 466.303 72.0694C470.431 74.6495 473.699 78.4768 476.107 83.5511C478.544 88.5968 479.763 94.7892 479.763 102.128C479.763 109.381 478.573 115.545 476.193 120.62C473.814 125.694 470.574 129.564 466.475 132.23C462.375 134.896 457.731 136.23 452.542 136.23C448.758 136.23 445.618 135.599 443.124 134.337C440.63 133.076 438.623 131.557 437.104 129.779C435.613 127.973 434.452 126.267 433.621 124.662H432.976V159.838H417.409ZM432.675 102.042C432.675 106.314 433.277 110.055 434.481 113.266C435.713 116.477 437.477 118.985 439.77 120.792C442.092 122.569 444.902 123.458 448.199 123.458C451.639 123.458 454.52 122.54 456.842 120.706C459.164 118.842 460.913 116.305 462.089 113.094C463.293 109.855 463.895 106.171 463.895 102.042C463.895 97.9427 463.307 94.3018 462.132 91.1196C460.956 87.9374 459.207 85.4433 456.885 83.6371C454.563 81.831 451.668 80.928 448.199 80.928C444.873 80.928 442.049 81.8023 439.727 83.5511C437.405 85.2999 435.642 87.7511 434.438 90.9046C433.262 94.0581 432.675 97.7707 432.675 102.042Z"
          fill="currentColor"
        />
        <path
          d="M405.575 86.4753L391.384 88.0234C390.983 86.59 390.28 85.2426 389.277 83.9812C388.302 82.7197 386.984 81.702 385.321 80.928C383.658 80.1539 381.623 79.7669 379.214 79.7669C375.975 79.7669 373.251 80.4693 371.044 81.874C368.865 83.2788 367.79 85.0992 367.819 87.3354C367.79 89.2562 368.492 90.8186 369.926 92.0227C371.388 93.2268 373.796 94.2158 377.15 94.9899L388.417 97.398C394.667 98.7455 399.311 100.881 402.35 103.805C405.417 106.73 406.966 110.557 406.994 115.287C406.966 119.444 405.747 123.114 403.339 126.296C400.96 129.449 397.648 131.915 393.405 133.692C389.162 135.47 384.289 136.359 378.784 136.359C370.7 136.359 364.192 134.667 359.261 131.284C354.33 127.873 351.392 123.128 350.446 117.05L365.626 115.588C366.314 118.57 367.776 120.82 370.012 122.34C372.248 123.859 375.158 124.619 378.741 124.619C382.44 124.619 385.407 123.859 387.643 122.34C389.908 120.82 391.04 118.942 391.04 116.706C391.04 114.814 390.309 113.252 388.847 112.019C387.414 110.786 385.177 109.84 382.139 109.181L370.872 106.816C364.536 105.497 359.849 103.275 356.81 100.15C353.771 96.9967 352.266 93.0117 352.295 88.1954C352.266 84.1245 353.37 80.5983 355.606 77.6167C357.871 74.6065 361.01 72.2844 365.024 70.6503C369.066 68.9875 373.724 68.1561 378.999 68.1561C386.74 68.1561 392.832 69.8046 397.276 73.1014C401.748 76.3983 404.514 80.8563 405.575 86.4753Z"
          fill="currentColor"
        />
        <path
          d="M297.566 96.366V135.068H281.999V69.0162H296.878V80.2399H297.652C299.171 76.5417 301.594 73.6031 304.919 71.4243C308.274 69.2455 312.416 68.1561 317.347 68.1561C321.905 68.1561 325.876 69.1309 329.259 71.0803C332.67 73.0298 335.308 75.8536 337.171 79.5519C339.064 83.2501 339.995 87.7367 339.967 93.0117V135.068H324.4V95.4199C324.4 91.0049 323.253 87.5504 320.959 85.0562C318.695 82.5621 315.555 81.315 311.542 81.315C308.818 81.315 306.396 81.917 304.274 83.1211C302.181 84.2965 300.533 86.0023 299.329 88.2384C298.154 90.4746 297.566 93.1838 297.566 96.366Z"
          fill="currentColor"
        />
        <path
          d="M267.832 46.9987V135.068H251.878V46.9987H267.832Z"
          fill="currentColor"
        />
        <path
          d="M704.066 217.989C703.854 216.11 702.981 214.655 701.446 213.623C699.911 212.577 697.979 212.055 695.65 212.055C693.983 212.055 692.541 212.319 691.324 212.849C690.106 213.365 689.16 214.079 688.486 214.992C687.824 215.892 687.493 216.917 687.493 218.068C687.493 219.034 687.718 219.868 688.168 220.569C688.631 221.27 689.233 221.859 689.974 222.336C690.728 222.799 691.535 223.189 692.395 223.507C693.256 223.811 694.083 224.062 694.876 224.261L698.846 225.293C700.143 225.61 701.472 226.04 702.835 226.583C704.198 227.125 705.462 227.84 706.626 228.726C707.79 229.613 708.73 230.711 709.444 232.021C710.172 233.331 710.536 234.899 710.536 236.725C710.536 239.027 709.941 241.072 708.75 242.858C707.572 244.644 705.859 246.053 703.609 247.085C701.373 248.117 698.667 248.633 695.492 248.633C692.448 248.633 689.815 248.151 687.592 247.185C685.369 246.219 683.63 244.849 682.373 243.076C681.116 241.29 680.421 239.173 680.289 236.725H686.441C686.56 238.194 687.037 239.418 687.87 240.397C688.717 241.363 689.795 242.084 691.105 242.56C692.429 243.023 693.877 243.255 695.452 243.255C697.185 243.255 698.727 242.984 700.076 242.441C701.439 241.885 702.511 241.118 703.292 240.139C704.072 239.146 704.463 237.989 704.463 236.665C704.463 235.461 704.119 234.476 703.431 233.708C702.756 232.941 701.836 232.306 700.672 231.803C699.521 231.3 698.217 230.857 696.762 230.473L691.959 229.163C688.704 228.277 686.124 226.973 684.218 225.253C682.326 223.533 681.38 221.257 681.38 218.426C681.38 216.084 682.015 214.039 683.286 212.293C684.556 210.546 686.276 209.19 688.446 208.224C690.616 207.245 693.064 206.755 695.789 206.755C698.542 206.755 700.97 207.238 703.073 208.204C705.19 209.17 706.858 210.5 708.075 212.194C709.292 213.874 709.927 215.806 709.98 217.989H704.066Z"
          fill="#2ED3C3"
        />
        <path
          d="M626.875 247.959V207.311H633.008V242.679H651.426V247.959H626.875Z"
          fill="#2ED3C3"
        />
        <path
          d="M595.755 227.635C595.755 231.975 594.961 235.706 593.373 238.829C591.785 241.938 589.608 244.333 586.843 246.014C584.091 247.681 580.962 248.514 577.455 248.514C573.936 248.514 570.793 247.681 568.028 246.014C565.275 244.333 563.105 241.932 561.518 238.809C559.93 235.686 559.136 231.962 559.136 227.635C559.136 223.295 559.93 219.57 561.518 216.461C563.105 213.338 565.275 210.943 568.028 209.276C570.793 207.596 573.936 206.755 577.455 206.755C580.962 206.755 584.091 207.596 586.843 209.276C589.608 210.943 591.785 213.338 593.373 216.461C594.961 219.57 595.755 223.295 595.755 227.635ZM589.681 227.635C589.681 224.327 589.145 221.542 588.074 219.279C587.015 217.003 585.56 215.283 583.707 214.119C581.868 212.941 579.784 212.352 577.455 212.352C575.113 212.352 573.023 212.941 571.183 214.119C569.344 215.283 567.889 217.003 566.817 219.279C565.758 221.542 565.229 224.327 565.229 227.635C565.229 230.943 565.758 233.735 566.817 236.011C567.889 238.273 569.344 239.993 571.183 241.171C573.023 242.335 575.113 242.917 577.455 242.917C579.784 242.917 581.868 242.335 583.707 241.171C585.56 239.993 587.015 238.273 588.074 236.011C589.145 233.735 589.681 230.943 589.681 227.635Z"
          fill="#2ED3C3"
        />
        <path
          d="M529.326 227.635C529.326 231.975 528.532 235.706 526.944 238.829C525.356 241.938 523.18 244.333 520.414 246.014C517.662 247.681 514.533 248.514 511.026 248.514C507.507 248.514 504.364 247.681 501.599 246.014C498.847 244.333 496.677 241.932 495.089 238.809C493.501 235.686 492.707 231.962 492.707 227.635C492.707 223.295 493.501 219.57 495.089 216.461C496.677 213.338 498.847 210.943 501.599 209.276C504.364 207.596 507.507 206.755 511.026 206.755C514.533 206.755 517.662 207.596 520.414 209.276C523.18 210.943 525.356 213.338 526.944 216.461C528.532 219.57 529.326 223.295 529.326 227.635ZM523.252 227.635C523.252 224.327 522.716 221.542 521.645 219.279C520.586 217.003 519.131 215.283 517.278 214.119C515.439 212.941 513.355 212.352 511.026 212.352C508.684 212.352 506.594 212.941 504.755 214.119C502.915 215.283 501.46 217.003 500.388 219.279C499.33 221.542 498.8 224.327 498.8 227.635C498.8 230.943 499.33 233.735 500.388 236.011C501.46 238.273 502.915 239.993 504.755 241.171C506.594 242.335 508.684 242.917 511.026 242.917C513.355 242.917 515.439 242.335 517.278 241.171C519.131 239.993 520.586 238.273 521.645 236.011C522.716 233.735 523.252 230.943 523.252 227.635Z"
          fill="#2ED3C3"
        />
        <path
          d="M433.88 212.591V207.311H465.338V212.591H452.656V247.959H446.543V212.591H433.88Z"
          fill="#2ED3C3"
        />
        <path
          d="M376.829 207.311L388.142 240.417H388.599L399.912 207.311H406.541L391.913 247.959H384.828L370.2 207.311H376.829Z"
          fill="#2ED3C3"
        />
        <path
          d="M316.126 247.959V207.311H341.61V212.591H322.259V224.975H340.281V230.235H322.259V242.679H341.849V247.959H316.126Z"
          fill="#2ED3C3"
        />
        <path
          d="M265.476 247.959H252.317V207.311H265.893C269.876 207.311 273.296 208.125 276.154 209.752C279.012 211.367 281.202 213.689 282.724 216.719C284.258 219.736 285.026 223.354 285.026 227.575C285.026 231.809 284.252 235.448 282.704 238.491C281.169 241.535 278.946 243.877 276.035 245.517C273.124 247.145 269.604 247.959 265.476 247.959ZM258.45 242.6H265.139C268.235 242.6 270.809 242.018 272.859 240.853C274.91 239.676 276.445 237.975 277.464 235.752C278.483 233.516 278.992 230.791 278.992 227.575C278.992 224.387 278.483 221.681 277.464 219.458C276.458 217.235 274.957 215.548 272.959 214.397C270.961 213.245 268.48 212.67 265.516 212.67H258.45V242.6Z"
          fill="#2ED3C3"
        />
      </svg>
    </LogoTitle>
  );
}

const Description = styled.p`
  ${({ theme }) => styledText(theme)};
  margin: 0;
  color: ${({ theme }) => theme.colors.grayDark};
`;

const FeatureList = styled.ul`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Feature = styled.li`
  ${({ theme }) => styledSmall(theme)};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  color: ${({ theme }) => theme.colors.grayDark};

  svg {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

/**
 * The diagnostics log rendered as text. The popup is a separate document that
 * survives the inspected page's death, which makes this the one "console"
 * available on an iPad: crashes recorded by the background's session sweep
 * and uncaught extension errors both surface here.
 */
const DiagnosticsList = styled.ol`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: 0;
  padding: ${({ theme }) => theme.spacing.radius.xs};
  list-style: none;
  max-height: 180px;
  overflow: auto;
  border: solid 1px ${({ theme }) => theme.colors.grayLight};
  border-radius: ${({ theme }) => theme.spacing.radius.xs};
`;

const DiagnosticItem = styled.li<{ $level: DiagnosticEntry["level"] }>`
  ${({ theme }) => styledSmall(theme)};
  font-family: ${({ theme }) => theme.fonts.mono};
  color: ${({ theme, $level }) =>
    $level === "error" ? theme.colors.error : theme.colors.grayDark};
  overflow-wrap: anywhere;
`;

const DiagnosticMeta = styled.span`
  color: ${({ theme }) => theme.colors.gray};
`;

const EmptyDiagnostics = styled.p`
  ${({ theme }) => styledSmall(theme)};
  margin: 0;
  color: ${({ theme }) => theme.colors.grayDark};
`;

type LaunchState = "idle" | "loading" | "success" | "error";

const INSPECTOR_HOST_ID = "inspector-lab-extension-root";
const INSPECTOR_SHOW_EVENT = "inspector-lab:show";

function revealExistingInspector(hostId: string, showEvent: string): boolean {
  const host = document.getElementById(hostId);
  if (!host) return false;
  // A running inspector answers by calling preventDefault. A host element left
  // behind by a mount that died answers nothing, and reporting it as revealed
  // would leave the page permanently unable to reopen the inspector: returning
  // false sends the caller down the inject path, where bootstrap() replaces the
  // dead shell.
  return !host.dispatchEvent(new Event(showEvent, { cancelable: true }));
}

function inspectorHostExists(hostId: string): boolean {
  return document.getElementById(hostId) !== null;
}

/**
 * Fast path for a tab that already has the inspector: re-show it without
 * re-evaluating the bundle. False means "not revealed, inject it" — including
 * when the browser cannot run the func form of executeScript at all (Orion on
 * iOS may be one). Falling through is safe rather than merely tolerable:
 * bootstrap() runs the same already-open check and SHOW_EVENT dispatch itself,
 * so a redundant injection re-shows the existing inspector instead of stacking
 * a second one. A genuine permission failure still surfaces, raised by the
 * injection below instead of here.
 */
async function revealInspector(tabId: number): Promise<boolean> {
  try {
    const [existing] = await chrome.scripting.executeScript({
      target: { tabId },
      func: revealExistingInspector,
      args: [INSPECTOR_HOST_ID, INSPECTOR_SHOW_EVENT],
    });
    return existing?.result === true;
  } catch {
    return false;
  }
}

/**
 * Confirms the freshly injected bundle actually mounted. executeScript resolves
 * once the file has been evaluated, and bootstrap() appends the host element
 * synchronously before any async work, so by this point the host is either
 * there or the bundle threw on its way up — which executeScript itself does not
 * report, since the injection succeeded and the throw stayed in the page.
 *
 * Only an explicit false counts as a failure. A browser that cannot run the
 * func form of executeScript keeps the old assume-success behavior rather than
 * gaining a false negative, which matters most on a tablet with no console to
 * check the claim against.
 */
async function confirmInspectorMounted(tabId: number): Promise<boolean> {
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId },
      func: inspectorHostExists,
      args: [INSPECTOR_HOST_ID],
    });
    return check?.result !== false;
  } catch {
    return true;
  }
}

function toExtensionPath(bundleUrl: string): string {
  const resolved = new URL(bundleUrl, chrome.runtime.getURL("/"));
  return resolved.pathname.replace(/^\//, "");
}

/**
 * chrome.cookies is gated on host permissions, which activeTab does not
 * extend to — without this grant the Cookies tab always reads empty. Asked
 * per site (never all sites), and only while the click gesture is fresh;
 * already-granted origins resolve true without showing a prompt.
 */
async function requestCookieAccess(tabUrl: string): Promise<boolean> {
  try {
    const origin = `${new URL(tabUrl).origin}/*`;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * Mirrors the popup's light/dark choice (Cherry's ThemeToggle persists it in
 * popup-page localStorage only) into chrome.storage.local, so the injected
 * inspector follows the same mode. Must render inside the ThemeProvider.
 */
function ColorSchemeSync() {
  const theme = useTheme();
  useEffect(() => {
    void saveColorSchemeSetting(theme.isDark ? "dark" : "light");
  }, [theme.isDark]);
  return null;
}

function Popup() {
  const [launchState, setLaunchState] = useState<LaunchState>("idle");
  const [message, setMessage] = useState("");
  const [customTheme, setCustomTheme] = useState(true);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void readCustomThemeSetting().then(setCustomTheme);
    void readDiagnostics().then(setDiagnostics);
  }, []);

  async function toggleDiagnostics() {
    // Re-read on open: the background sweep may have run since mount.
    if (!diagnosticsOpen) setDiagnostics(await readDiagnostics());
    setDiagnosticsOpen(!diagnosticsOpen);
  }

  async function copyDiagnostics() {
    const text = diagnostics
      .map(
        (entry) =>
          `[${new Date(entry.time).toISOString()}] ${entry.source} ${entry.level}: ${entry.message}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard denied: the list stays readable on screen. */
    }
  }

  async function onClearDiagnostics() {
    if (await clearDiagnostics()) setDiagnostics([]);
  }

  /* Optimistic flip; an open inspector rethemes live via storage.onChanged. */
  function onCustomThemeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const enabled = event.target.checked;
    setCustomTheme(enabled);
    void saveCustomThemeSetting(enabled).then((saved) => {
      if (!saved) setCustomTheme(!enabled);
    });
  }

  async function launchInspector() {
    setLaunchState("loading");
    setMessage("");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.id || !tab.url) {
        throw new Error("No active webpage is available.");
      }

      if (!/^(https?|file):/.test(tab.url)) {
        throw new Error(
          "Chrome protects this page. Open a regular website and try again.",
        );
      }

      // Before any await chains: permission prompts need the user gesture.
      const cookieAccess = /^https?:/.test(tab.url)
        ? await requestCookieAccess(tab.url)
        : false;

      const revealed = await revealInspector(tab.id);

      if (!revealed) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [toExtensionPath(inspectorBundleUrl)],
        });

        if (!(await confirmInspectorMounted(tab.id))) {
          throw new Error(
            "The inspector was injected but did not start on this page. This browser may not support everything it needs.",
          );
        }
      }

      setLaunchState("success");
      setMessage(
        cookieAccess
          ? "Inspector launched. You can close this popup."
          : "Inspector launched. Cookie access was not granted, so the Cookies tab will stay empty on this site.",
      );
    } catch (error) {
      setLaunchState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The inspector could not open.",
      );
    }
  }

  return (
    <ThemeProvider>
      <ColorSchemeSync />
      <PopupShell>
        <Header>
          <Flex $alignItems="center" $justifyContent="space-between" $gap={12}>
            <Logo />
            <ThemeToggle aria-label="Toggle popup theme" />
          </Flex>
        </Header>

        <Description>
          Drop a lightweight inspector over the current page. Move it, resize
          it, and point at any element to inspect it right where it lives.
        </Description>

        <FeatureList>
          <Feature>
            <Icon name="Move" size={16} /> Drag from the instrument bar
          </Feature>
          <Feature>
            <Icon name="Scaling" size={16} /> Resize from the lower-right corner
          </Feature>
          <Feature>
            <Icon name="MousePointer2" size={16} /> Pick and inspect page
            elements
          </Feature>
        </FeatureList>

        <Toggle
          id="inspector-custom-theme"
          $label="Use custom inspector theme"
          checked={customTheme}
          onChange={onCustomThemeChange}
        />

        <Button
          $fullWidth
          $size="big"
          $icon={<Icon name="ScanSearch" />}
          disabled={launchState === "loading"}
          onClick={launchInspector}
        >
          {launchState === "loading" ? "Injecting…" : "Open page inspector"}
        </Button>

        {message && (
          <Callout
            $type={launchState === "error" ? "danger" : "success"}
            role="status"
          >
            {message}
          </Callout>
        )}

        <Flex $alignItems="center" $justifyContent="space-between" $gap={12}>
          <Button
            $size="small"
            $outline
            $icon={<Icon name="ScrollText" />}
            aria-expanded={diagnosticsOpen}
            onClick={toggleDiagnostics}
          >
            {diagnosticsOpen
              ? "Hide diagnostics"
              : `Diagnostics${diagnostics.length > 0 ? ` (${diagnostics.length})` : ""}`}
          </Button>
          {diagnosticsOpen && diagnostics.length > 0 && (
            <Flex $gap={12}>
              <Button $size="small" $outline onClick={copyDiagnostics}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button $size="small" $outline onClick={onClearDiagnostics}>
                Clear
              </Button>
            </Flex>
          )}
        </Flex>

        {diagnosticsOpen &&
          (diagnostics.length > 0 ? (
            <DiagnosticsList aria-label="Diagnostics log">
              {[...diagnostics].reverse().map((entry, index) => (
                <DiagnosticItem
                  key={`${entry.time}-${index}`}
                  $level={entry.level}
                >
                  <DiagnosticMeta>
                    {new Date(entry.time).toLocaleString()} · {entry.source}
                  </DiagnosticMeta>{" "}
                  {entry.message}
                </DiagnosticItem>
              ))}
            </DiagnosticsList>
          ) : (
            <EmptyDiagnostics>
              No diagnostics recorded. Extension errors and sessions that end
              without a clean close will show up here.
            </EmptyDiagnostics>
          ))}
      </PopupShell>
    </ThemeProvider>
  );
}

export default Popup;
