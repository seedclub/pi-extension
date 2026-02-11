/**
 * Twitter Network Analysis Tools
 * 
 * Analyze following patterns across Seed Network signals to identify
 * emerging profiles getting attention from the network.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getTwitterClient } from "../twitter-client";
import { api } from "../api-client";
import { wrapExecute } from "../tool-utils";

interface Signal {
  id: string;
  name: string;
  twitterUsername?: string;
  metadata?: {
    twitterUsername?: string;
    twitter?: string;
  };
}

interface ProfileOverlap {
  userId: string;
  username: string;
  name: string;
  description: string;
  followersCount: number;
  followedBy: string[]; // Signal usernames that follow this profile
  overlapCount: number;
  profileUrl: string;
  profileImageUrl?: string;
}

interface NetworkAnalysisResult {
  emergingProfiles: ProfileOverlap[];
  stats: {
    signalsAnalyzed: number;
    signalsWithTwitter: number;
    totalProfilesChecked: number;
    uniqueProfiles: number;
    overlapsFound: number; // Total profiles meeting minOverlap threshold
    topNReturned: number; // Number of top profiles returned
    processingTimeMs: number;
  };
  errors?: string[];
}

// Helper to extract Twitter username from signal
function getTwitterUsername(signal: Signal): string | null {
  if (signal.twitterUsername) return signal.twitterUsername;
  if (signal.metadata?.twitterUsername) return signal.metadata.twitterUsername;
  if (signal.metadata?.twitter) return signal.metadata.twitter;
  return null;
}

// Helper to add delay between requests (rate limiting)
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeNetworkFollows(args: {
  minOverlap?: number;
  sampleSize?: number;
  delayMs?: number;
  signalLimit?: number;
  topN?: number;
  useSampleNetwork?: boolean;
  testUsernames?: string[];
}): Promise<NetworkAnalysisResult> {
  const startTime = Date.now();
  const minOverlap = args.minOverlap ?? 1; // Default to 1 (count everyone)
  const sampleSize = args.sampleSize ?? 20; // Default to 20 (recent follows only)
  const delayMs = args.delayMs ?? 1500; // 1.5 seconds between requests
  const signalLimit = args.signalLimit; // Optional: limit number of signals to analyze
  const topN = args.topN ?? 10; // Return top 10 by default
  
  const errors: string[] = [];
  
  try {
    let allSignals: Signal[] = [];

    // Step 1: Get signals - either from sample network, test usernames, or API
    if (args.useSampleNetwork) {
      // Load sample network from file
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const samplePath = join(__dirname, "../sample-network.js");
        const content = readFileSync(samplePath, "utf-8");
        const match = content.match(/x_usernames\s*=\s*\[([\s\S]*?)\]/);
        if (match) {
          const usernames = match[1]
            .split(",")
            .map(u => u.trim().replace(/["']/g, ""))
            .filter(u => u.length > 0);
          allSignals = usernames.map((username, idx) => ({
            id: `sample-${idx}`,
            name: `Sample Signal ${idx + 1}`,
            twitterUsername: username,
          }));
        }
      } catch (e) {
        errors.push(`Failed to load sample network: ${e}`);
      }
    } else if (args.testUsernames && args.testUsernames.length > 0) {
      // Use provided test usernames
      allSignals = args.testUsernames.map((username, idx) => ({
        id: `test-${idx}`,
        name: `Test Signal ${idx + 1}`,
        twitterUsername: username,
      }));
    } else {
      // Get from API
      try {
        const signalsResponse = await api.get<{ signals: Signal[] }>("/signals");
        allSignals = signalsResponse.signals || [];
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          emergingProfiles: [],
          stats: {
            signalsAnalyzed: 0,
            signalsWithTwitter: 0,
            totalProfilesChecked: 0,
            uniqueProfiles: 0,
            overlapsFound: 0,
            topNReturned: 0,
            processingTimeMs: Date.now() - startTime,
          },
          errors: [`Failed to fetch signals: ${msg}`],
        };
      }
    }
    
    // Step 2: Filter signals with Twitter usernames
    const signalsWithTwitter = allSignals
      .map(signal => ({
        signal,
        twitterUsername: getTwitterUsername(signal),
      }))
      .filter(item => item.twitterUsername !== null);

    if (signalsWithTwitter.length === 0) {
      return {
        emergingProfiles: [],
        stats: {
          signalsAnalyzed: allSignals.length,
          signalsWithTwitter: 0,
          totalProfilesChecked: 0,
          uniqueProfiles: 0,
          overlapsFound: 0,
          topNReturned: 0,
          processingTimeMs: Date.now() - startTime,
        },
        errors: ["No signals with Twitter usernames found"],
      };
    }

    // Apply signal limit if specified
    const signalsToAnalyze = signalLimit 
      ? signalsWithTwitter.slice(0, signalLimit)
      : signalsWithTwitter;

    console.log(`\n📡 Network Analysis Configuration:`);
    console.log(`   • Signals to analyze: ${signalsToAnalyze.length}`);
    console.log(`   • Follows per signal: ${sampleSize}`);
    console.log(`   • Estimated profiles: ~${signalsToAnalyze.length * sampleSize}`);
    console.log(`   • Rate limit delay: ${delayMs}ms`);
    console.log(`   • Est. time: ~${Math.round((signalsToAnalyze.length * delayMs) / 1000 / 60)}m\n`);

    // Step 3: Get Twitter client
    const client = await getTwitterClient();

    // Step 4: Fetch following lists for each signal
    // Map: userId -> { profile, followedBy: [signalUsernames] }
    const profileMap = new Map<string, {
      profile: any;
      followedBy: Set<string>;
    }>();

    let totalProfilesChecked = 0;

    console.log(`\n🔍 Starting network analysis...`);
    console.log(`📊 Analyzing ${signalsToAnalyze.length} signals (${sampleSize} recent follows each)\n`);

    for (let i = 0; i < signalsToAnalyze.length; i++) {
      const { signal, twitterUsername } = signalsToAnalyze[i];
      const progress = `[${i + 1}/${signalsToAnalyze.length}]`;
      
      console.log(`${progress} 🔎 Scanning @${twitterUsername}...`);
      
      try {
        // Get user ID for this signal
        const userIdResult = await client.getUserIdByUsername(twitterUsername!);
        if (!userIdResult.success || !userIdResult.userId) {
          const errorMsg = `Failed to get user ID for @${twitterUsername}: ${userIdResult.error}`;
          errors.push(errorMsg);
          console.log(`${progress} ❌ @${twitterUsername} - ${userIdResult.error}`);
          continue;
        }

        // Add delay to avoid rate limiting (except first request)
        if (i > 0) {
          await delay(delayMs);
        }

        // Get recent following
        const followingResult = await client.getFollowing(userIdResult.userId, sampleSize);
        if (!followingResult.success || !followingResult.users) {
          const errorMsg = `Failed to get following for @${twitterUsername}: ${followingResult.error}`;
          errors.push(errorMsg);
          console.log(`${progress} ❌ @${twitterUsername} - ${followingResult.error}`);
          continue;
        }

        totalProfilesChecked += followingResult.users.length;
        console.log(`${progress} ✅ @${twitterUsername} - Found ${followingResult.users.length} follows`);

        // Add each followed profile to the map
        for (const user of followingResult.users) {
          if (!profileMap.has(user.id)) {
            profileMap.set(user.id, {
              profile: user,
              followedBy: new Set(),
            });
          }
          profileMap.get(user.id)!.followedBy.add(twitterUsername!);
        }

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Error processing @${twitterUsername}: ${msg}`);
        console.log(`${progress} ❌ @${twitterUsername} - ${msg}`);
      }
    }

    console.log(`\n✨ Analysis complete! Processing results...\n`);

    // Step 5: Build list of all profiles with their follow counts
    const allProfiles: ProfileOverlap[] = [];

    for (const [userId, data] of profileMap.entries()) {
      if (data.followedBy.size >= minOverlap) {
        const user = data.profile;
        allProfiles.push({
          userId: user.id,
          username: user.username,
          name: user.name || user.username,
          description: user.description || "",
          followersCount: user.followersCount || 0,
          followedBy: Array.from(data.followedBy),
          overlapCount: data.followedBy.size,
          profileUrl: `https://x.com/${user.username}`,
          profileImageUrl: user.profileImageUrl?.replace("_normal", "_400x400"),
        });
      }
    }

    // Sort by overlap count (descending), then by followers
    allProfiles.sort((a, b) => {
      if (b.overlapCount !== a.overlapCount) {
        return b.overlapCount - a.overlapCount;
      }
      return b.followersCount - a.followersCount;
    });

    // Take top N most-followed profiles
    const emergingProfiles = allProfiles.slice(0, topN);

    const processingTimeMs = Date.now() - startTime;
    console.log(`📊 Results Summary:`);
    console.log(`   • Unique profiles found: ${profileMap.size}`);
    console.log(`   • Profiles with ${minOverlap}+ overlaps: ${allProfiles.length}`);
    console.log(`   • Top profiles returned: ${emergingProfiles.length}`);
    console.log(`   • Processing time: ${(processingTimeMs / 1000).toFixed(1)}s`);
    if (errors.length > 0) {
      console.log(`   • Errors: ${errors.length}`);
    }
    console.log(``);

    return {
      emergingProfiles,
      stats: {
        signalsAnalyzed: allSignals.length,
        signalsWithTwitter: signalsWithTwitter.length,
        totalProfilesChecked,
        uniqueProfiles: profileMap.size,
        overlapsFound: allProfiles.length, // Total profiles with minOverlap+
        topNReturned: emergingProfiles.length, // Actually returned (top N)
        processingTimeMs,
      },
      errors: errors.length > 0 ? errors : undefined,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      emergingProfiles: [],
      stats: {
        signalsAnalyzed: 0,
        signalsWithTwitter: 0,
        totalProfilesChecked: 0,
        uniqueProfiles: 0,
        overlapsFound: 0,
        topNReturned: 0,
        processingTimeMs: Date.now() - startTime,
      },
      errors: [msg],
    };
  }
}

export function registerTwitterNetworkTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "analyze_network_follows",
    label: "Analyze Network Following Patterns",
    description: `Analyze who Seed Network signals are following to discover trending profiles.
    
Scans recent follows (default: 20 per signal) across the entire network and returns the 
TOP profiles followed by the most signals. Perfect for discovering who's getting attention
from your network.

Example: 600 signals × 20 follows = 12,000 profiles analyzed → Top 10 most-followed

Returns profiles ranked by how many signals follow them (overlap count).`,
    parameters: Type.Object({
      topN: Type.Optional(Type.Number({
        description: "Number of top profiles to return, ranked by overlap count (default: 10)",
        minimum: 1,
        maximum: 100,
      })),
      sampleSize: Type.Optional(Type.Number({
        description: "Number of recent follows to check per signal (default: 20, recommended: 20-50)",
        minimum: 10,
        maximum: 200,
      })),
      minOverlap: Type.Optional(Type.Number({
        description: "Minimum signals that must follow a profile to be included (default: 1 = count everyone)",
        minimum: 1,
      })),
      delayMs: Type.Optional(Type.Number({
        description: "Delay in ms between Twitter API calls to avoid rate limiting (default: 1500)",
        minimum: 500,
        maximum: 5000,
      })),
      signalLimit: Type.Optional(Type.Number({
        description: "Limit number of signals to analyze (for testing, default: all)",
        minimum: 1,
      })),
      useSampleNetwork: Type.Optional(Type.Boolean({
        description: "Use sample network from sample-network.js file (for testing, default: false)",
      })),
      testUsernames: Type.Optional(Type.Array(Type.String(), {
        description: "Array of Twitter usernames to test with (alternative to API or sample network)",
      })),
    }),
    execute: wrapExecute(analyzeNetworkFollows),
  });
}
